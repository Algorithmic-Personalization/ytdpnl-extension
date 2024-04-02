import type SubAppCreator from './SubApp';
import {type SubAppInstance, type SubAppState} from './SubApp';
import {type Api} from './api';
import {type ParticipantConfig} from './common/models/experimentConfig';
import WatchTimeEvent from './common/models/watchTimeEvent';
import {
	log,
	isLoggedInForSureYt,
	saveToLocalStorage,
	getFromLocalStorage,
	removeLoaderMask,
	isVideoPage,
} from './lib';

type ElementToWaitFor = {
	selector: string;
	resolve: (elt: Element) => void;
	timeout: NodeJS.Timeout;
};

/* D
const createDebounce = (ms: number) => (fn: () => void) => {
	let timeout: NodeJS.Timeout;

	return () => {
		clearTimeout(timeout);
		timeout = setTimeout(fn, ms);
	};
};

const debounce = createDebounce(500);
*/

const loadPersistedConfig = () => {
	const item = getFromLocalStorage('config');

	try {
		if (item) {
			return JSON.parse(item) as ParticipantConfig;
		}
	} catch (err) {
		log('Error parsing config from local storage:', {err, item});
		return undefined;
	}

	return undefined;
};

export const createExtension = (api: Api, log: (...args: any[]) => void) => (subApps: SubAppCreator[]) => {
	let elementsToWaitFor: ElementToWaitFor[] = [];
	const subAppInstances: SubAppInstance[] = [];

	const config = loadPersistedConfig();

	const state: SubAppState = {
		loggedInYouTube: getFromLocalStorage('loggedInYouTube') === 'true',
		config,
		loggedInExtension: Boolean(config),
		url: location.href,
	};

	let watchTime = 0;
	let lastDisplayedTime = 0;
	let currentTime = 0;
	let urlWatched: string | undefined;

	const timeUpdate = (e: Event) => {
		const newCurrentTime = (e.target as HTMLVideoElement).currentTime;

		const dt = newCurrentTime - currentTime;
		currentTime = newCurrentTime;

		if (dt > 0) {
			watchTime += dt;
		}

		if (watchTime - lastDisplayedTime > 10) {
			lastDisplayedTime = watchTime;
			log('watch time:', watchTime);
		}
	};

	api.addOnLogoutListener(() => {
		triggerUpdate({config: undefined});
	});

	const watchVideoEvents = (video: HTMLVideoElement, url: string) => {
		video.removeEventListener('timeupdate', timeUpdate);
		video.addEventListener('timeupdate', timeUpdate);
		urlWatched = url;
	};

	const saveWatchTime = () => {
		if (urlWatched) {
			if (watchTime > 0) {
				log('saving watch time for', urlWatched, 'with', watchTime, 'seconds');
				const event = new WatchTimeEvent(watchTime);
				event.url = urlWatched;
				api.postEvent(event, true).then(() => {
					log('watch time event sent successfully');
				}, err => {
					log('error', 'failed to send watch time event', err);
				});

				watchTime = 0;
				lastDisplayedTime = 0;
			}
		}
	};

	const onUnload = () => {
		saveWatchTime();
	};

	const setupVideoWatching = (url: string) => {
		if (isVideoPage(url)) {
			log('looking for a video element on', url);
			const video = document.querySelector('video');

			if (video) {
				log('video element found:', video);
				watchVideoEvents(video, url);
				document.removeEventListener('unload', onUnload);
				document.addEventListener('unload', onUnload);
			} else {
				log('no video element found');
			}
		}
	};

	let previousUrl: string | undefined;

	const fetchConfig = async () => {
		api.getConfig().then(config => {
			if (config.kind === 'Success') {
				triggerUpdate({config: config.value});
			} else {
				log('error', 'could not get config:', config.message);
			}
		}).catch(err => {
			log('error', 'error getting config:', err);
		});
	};

	const onUrlChange = (url: string) => {
		log('URL changed to', url);
		triggerUpdate({url});
		void fetchConfig();
	};

	const checkLoggedInYouTube = () => {
		isLoggedInForSureYt().then(loggedIn => {
			const isLoggedIn = loggedIn === 'yes';
			saveToLocalStorage('loggedInYouTube', isLoggedIn ? 'true' : 'false');

			if (state.loggedInYouTube !== isLoggedIn) {
				triggerUpdate({loggedInYouTube: isLoggedIn});
			}
		}).catch(err => {
			log('error', 'error checking if logged in to YouTube', err);
		});
	};

	// D const checkLoggedInYouTubeDebounced = debounce(checkLoggedInYouTube);

	type DeletionWatcher = {
		elt: Element;
		onDeleted: () => void;
	};

	const watchListForDeletion: DeletionWatcher[] = [];

	const observer = new MutationObserver(e => {
		for (const rec of e) {
			for (const r of Array.from(rec.removedNodes)) {
				for (const {elt: element, onDeleted: callback} of watchListForDeletion) {
					if (r.contains(element)) {
						callback();
					}
				}
			}
		}

		if (location.href !== previousUrl) {
			api.sendPageView();
			onUrlChange(location.href);
			previousUrl = location.href;
		}

		elementsToWaitFor = elementsToWaitFor.filter(({selector, resolve, timeout}) => {
			const elt = document.querySelector(selector);

			if (elt) {
				resolve(elt);
				clearTimeout(timeout);
				return false;
			}

			return true;
		});
	});

	const getElement = async (selector: string, timeoutMs = 10000): Promise<Element> => {
		const select = () => document.querySelector(selector);

		const elt = select();

		if (elt) {
			return elt;
		}

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('Timeout waiting for element with selector: ' + selector));
			}, timeoutMs);

			elementsToWaitFor.push({selector, resolve, timeout});
		});
	};

	const doTriggerUpdate = (newState: Partial<SubAppState>) => {
		log('new state received:', newState);

		const updatedState = {...state, ...newState};

		if (newState.url !== state.url && newState.url) {
			saveWatchTime();
			setupVideoWatching(newState.url);
		}

		if (newState.config) {
			updatedState.loggedInExtension = true;

			saveToLocalStorage('config', JSON.stringify(newState.config));
		}

		if (updatedState.config) {
			if (updatedState.config.arm === 'control') {
				removeLoaderMask();
			}

			if (updatedState.config.phase !== 1) {
				removeLoaderMask();
			}
		} else {
			removeLoaderMask();
		}

		if (!updatedState.loggedInYouTube) {
			removeLoaderMask();
		}

		if (Object.prototype.hasOwnProperty.call(newState, 'config') && !newState.config) {
			updatedState.loggedInExtension = false;
			saveToLocalStorage('config', '');
		}

		for (const app of subAppInstances) {
			app.onUpdate(updatedState, state).catch(err => {
				removeLoaderMask();
				log('error', 'error updating sub-app', app.getName(), ':', err);
			});
		}

		Object.assign(state, updatedState);
	};

	const triggerUpdate = (newState: Partial<SubAppState>) => {
		try {
			doTriggerUpdate(newState);
		} catch (err) {
			log('error', 'error triggering apps update:', err);
			removeLoaderMask();
		}
	};

	const replaceLogo = () => {
		getElement('yt-icon#logo-icon,a#logo').then(elt => {
			log('YouTube logo found', elt);
			elt.addEventListener('click', e => {
				log('home link clicked');
				e.preventDefault();
				window.location.href = 'https://www.youtube.com/';
			});

			watchListForDeletion.push({
				elt,
				onDeleted() {
					log('YouTube logo removed, replacing it again');
					replaceLogo();
				},
			});
		}, err => {
			log('error', 'error getting home link:', err);
		});
	};

	const doStart = async () => {
		setupVideoWatching(state.url ?? '');
		replaceLogo();

		log('Starting extension with', subApps.length, 'sub-apps');
		log('Observing document for changes');
		observer.observe(document.documentElement, {childList: true, subtree: true});

		for (const app of subApps) {
			const instance = app({
				api,
				getElement,
				triggerUpdate,
				log,
			});

			subAppInstances.push(instance);

			triggerUpdate(state);
		}

		checkLoggedInYouTube();

		if (api.getAuth()) {
			if (!state.config) {
				void fetchConfig();
			}

			// FIXME: do not open session if already opened
			api.newSession().then(uuid => {
				log('New session created:', uuid);
			}, err => {
				log('error', 'error creating new session:', err);
			});
		}
	};

	const start = async () => {
		try {
			await doStart();
		} catch (err) {
			removeLoaderMask();
			log('error', 'failed to start extension:', err);
		}
	};

	return {
		start,
	};
};

export default createExtension;
