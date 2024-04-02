import React from 'react';
import {createRoot, type Root as ReactDomRoot} from 'react-dom/client';

import {
	type SubAppCreator,
	type SubAppInstance,
	ReactAdapter,
} from '../SubApp';

import {
	imageExists,
	isHomePage,
	findParentById,
	removeLoaderMask,
	sleep,
	getRecommendationsOnPage,
} from '../lib';

import fetchRecommendationsToInject from '../fetchYtChannelRecommendations';
import type Recommendation from '../common/types/Recommendation';
import {type RecommendationBase} from '../common/types/Recommendation';

import {type Api} from '../api';
import {Event as AppEvent, EventType} from '../common/models/event';

import HomeVideoCard, {getHomeMiniatureUrl} from '../components/HomeVideoCard';
import HomeShownEvent from '../common/models/homeShownEvent';

type HomeVideo = {
	videoId: string;
	title: string;
	url: string;
};

type ReactRoot = {
	elt: Element;
	root: ReactDomRoot;
};

const replaceHomeVideo = (api: Api, log: (...args: any[]) => void) => (
	videoId: string,
	recommendation: Recommendation,
	onPictureLoaded?: () => void,
	onPictureErrored?: () => void,
): ReactRoot | undefined => {
	const links = Array.from(document.querySelectorAll(`a.ytd-thumbnail[href="/watch?v=${videoId}"]`));

	if (links.length === 0) {
		log('error', 'could not find link for', videoId);
		return undefined;
	}

	if (links.length > 1) {
		log('error', 'found multiple links for', videoId);
		return undefined;
	}

	const [link] = links;

	const parent = findParentById('content')(link);

	if (!parent) {
		log('error', 'could not find parent for', videoId);
		return undefined;
	}

	const onInjectedVideoCardClicked = async () => {
		const event = new AppEvent();
		event.type = EventType.HOME_INJECTED_TILE_CLICKED;
		event.url = recommendation.url;
		event.context = window.location.href;
		void api.postEvent(event, true).catch(err => {
			log('failed to send home injected tile clicked event, will be retried', err);
		});
	};

	const card = (
		<ReactAdapter api={api}>
			<HomeVideoCard {
				...{
					...recommendation,
					onClick: onInjectedVideoCardClicked,
					onPictureLoaded,
					onPictureErrored,
				}} />
		</ReactAdapter>
	);

	const root = createRoot(parent);
	root.render(card);

	return {
		elt: parent,
		root,
	};
};

const getRecommendationsToInject = (api: Api, log: (...args: any[]) => void) => async (channelSource: string): Promise<Recommendation[]> => {
	const getRecommendations = async (force = false): Promise<Recommendation[]> => {
		const recommendationsSource = force ? await api.getChannelSource(force) : channelSource;
		log('trying to get the recommendations to inject from:', recommendationsSource);

		const channelData = await fetchRecommendationsToInject(recommendationsSource);
		log('raw injection source channel data:', channelData);

		const unfilteredRecommendations = channelData.map(({recommendation}) => recommendation).slice(0, 10);
		log('unfiltered recommendations:', unfilteredRecommendations);

		const filterPromises = unfilteredRecommendations.map(async r => {
			const exists = await imageExists(getHomeMiniatureUrl(r.videoId));
			return {ok: exists, rec: r};
		});

		const filtered = await Promise.all(filterPromises);
		log('filtered recommendations:', filtered);

		return filtered.filter(({ok}) => ok).map(({rec}) => rec);
	};

	let recommendations: Recommendation[] = [];

	const waitDelays = [1000, 2000, 3000, 5000, 8000];
	const maxAttempts = waitDelays.length;
	let attempts = 0;

	while (recommendations.length < 3 && attempts < maxAttempts) {
		log('attempt', attempts + 1, 'of', maxAttempts, 'to get recommendations to inject');
		++attempts;

		// eslint-disable-next-line no-await-in-loop
		recommendations = await getRecommendations(attempts >= 3);

		if (recommendations.length < 3) {
			const delay = waitDelays[attempts - 1];
			log('trying again in', delay, 'ms');
			// eslint-disable-next-line no-await-in-loop
			await new Promise(resolve => {
				setTimeout(resolve, delay);
			});
		}
	}

	return recommendations;
};

const hasRecommendations = (rs: RecommendationBase[]): string =>
	rs.map(r => r.videoId).join(',');

const hashHomeShownEvent = (e: HomeShownEvent): string => {
	const {defaultRecommendations, replacementSource, shown} = e;

	const hash = [
		hasRecommendations(defaultRecommendations),
		hasRecommendations(replacementSource),
		hasRecommendations(shown ?? []),
	].join('-');

	return hash;
};

const homeApp: SubAppCreator = ({api, log}) => {
	let channelSource: string | undefined;
	let channelPos: number | undefined;
	let replacementSource: Recommendation[] = [];
	let homeVideos: HomeVideo[] = [];
	let hasIntervention = false;
	const roots: ReactRoot[] = [];
	const shown: RecommendationBase[] = [];
	let latestEventSentHash: string | undefined;

	let initializationAttempted = false;

	const replace = replaceHomeVideo(api, log);

	const triggerEvent = async (): Promise<boolean> => {
		if (homeVideos.length === 0) {
			return false;
		}

		if (!hasIntervention) {
			log('no intervention on home, just scraping...');

			const event = new HomeShownEvent(
				homeVideos.slice(0, 10),
				[],
				[],
			);

			const hash = hashHomeShownEvent(event);

			if (hash === latestEventSentHash) {
				log('home shown event already sent, returning...');
				return true;
			}

			latestEventSentHash = hash;

			api.postEvent(event, true).then(() => {
				log('home shown event sent successfully');
			}, err => {
				log('error', 'failed to send home shown event', err);
			});

			return true;
		}

		if (shown.length === 0) {
			return false;
		}

		if (replacementSource.length === 0) {
			return false;
		}

		const event = new HomeShownEvent(
			homeVideos.slice(0, 10),
			replacementSource,
			shown,
		);

		event.extra = {
			channelSource,
			channelPos,
		};

		const hash = hashHomeShownEvent(event);

		if (hash === latestEventSentHash) {
			log('home shown event already sent, returning...');
			return true;
		}

		latestEventSentHash = hash;

		return api.postEvent(event, true).then(() => {
			log('home shown event sent successfully');
			return true;
		}, err => {
			log('error', 'failed to send home shown event', err);
			return false;
		});
	};

	const initialize = async (maybeNewChannelSource?: string) => {
		initializationAttempted = true;
		const nToReplace = 3;

		if (maybeNewChannelSource) {
			log('fetching recommendations to inject...');

			replacementSource = await getRecommendationsToInject(api, log)(maybeNewChannelSource);
			channelSource = maybeNewChannelSource;

			log('injection source data:', replacementSource);
		}

		if (homeVideos.length === 0) {
			homeVideos = (await getRecommendationsOnPage(log)('a.ytd-thumbnail[href^="/watch?v="]')).splice(0, 10);
		}

		log('home videos:', homeVideos);

		if (homeVideos.length < nToReplace) {
			log('error', 'not enough videos to replace');
			removeLoaderMask();
			return [];
		}

		if (maybeNewChannelSource && replacementSource.length < nToReplace) {
			log('error', 'not enough recommendations to inject');
			removeLoaderMask();
			return [];
		}

		if (shown.length > 0) {
			log('already replaced videos, returning...', {shown});
			removeLoaderMask();
			return [];
		}

		const picturePromises: Array<Promise<void>> = [];

		if (replacementSource.length >= nToReplace) {
			for (let i = 0; i < nToReplace; ++i) {
				const video = homeVideos[i];
				const replacement = replacementSource[i];

				if (!video || !replacement) {
					throw new Error('video or replacement is undefined - should never happen');
				}

				const picturePromise = new Promise<void>((resolve, reject) => {
					const root = replace(video.videoId, replacement, resolve, reject);

					if (root) {
						log('video', video, 'replaced with', replacement, 'successfully');
						roots.push(root);
						shown.push(replacement);
						picturePromises.push(picturePromise);
					} else {
						log('failed to replace video', video, 'with', replacement);
						shown.push(video);
					}
				});
			}

			// Keep track the rest of the videos shown
			shown.push(...homeVideos.slice(nToReplace));
		}

		if (picturePromises.length > 0) {
			log('waiting for all pictures to load...');
			await Promise.race([
				Promise.allSettled(picturePromises).then(() => {
					log('all pictures loaded as expected');
				}),
				sleep(5000).then(() => {
					log('timed out waiting for all pictures to load');
				}),
			]);
			log('all pictures loaded');

			removeLoaderMask();
		}

		triggerEvent().then(triggered => {
			if (triggered) {
				log('home shown event triggered successfully upon app initialization');
			} else {
				log('error', 'home shown event not triggered upon app initialization, something went wrong');
			}
		}, err => {
			log('error', 'failed to trigger home shown event upon update', err);
		});

		return [];
	};

	const app: SubAppInstance = {
		getName() {
			return 'homeApp';
		},

		async onUpdate(state, prevState) {
			if (!isHomePage(state.url ?? '')) {
				return [];
			}

			if (!state.loggedInYouTube) {
				return [];
			}

			if (state.url !== prevState.url && isHomePage(state.url ?? '')) {
				triggerEvent().then(triggered => {
					if (triggered) {
						log('home shown event triggered upon URL change');
					} else {
						log('home shown event not triggered upon URL change, app may not be ready');
					}
				}, err => {
					log('error', 'failed to trigger home shown event upon URL change', err);
				});
			}

			if (initializationAttempted) {
				log('home app already initialized, returning...');
				return [];
			}

			if (!state.url || !state.config) {
				return [];
			}

			log('Setting up home app', state);

			if (state.config.arm === 'treatment' && state.config.phase === 1) {
				hasIntervention = true;

				const {channelSource: maybeNewChannelSource} = state.config;
				channelPos = state.config.pos;

				if (!maybeNewChannelSource) {
					log('no channel source in state, returning...');
					return [];
				}

				if (maybeNewChannelSource === channelSource) {
					log('channel source unchanged, returning...');
					return [];
				}

				log('got new channel source');

				if (replacementSource.length > 0) {
					log('injection source already exists, returning...');
					return [];
				}

				initialize(maybeNewChannelSource).catch(err => {
					removeLoaderMask();
					log('error', 'failed to initialize home app', err);
				});
			} else {
				removeLoaderMask();
				initialize().catch(err => {
					log('error', 'failed to initialize home app', err);
				});
			}

			return [];
		},

		onDestroy(elt: HTMLElement) {
			log('element destroyed', elt);
		},
	};

	return app;
};

export default homeApp;
