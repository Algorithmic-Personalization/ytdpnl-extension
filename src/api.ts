import {type ParticipantChannelSource} from './common/types/participantChannelSource';
import {type Maybe, makeApiVerbCreator} from './common/util';
import type Session from './common/models/session';
import Event, {EventType} from './common/models/event';
import {type ParticipantConfig} from './common/models/experimentConfig';

import {compressToUTF16, decompressFromUTF16} from 'lz-string';

import packageJson from '../package.json';

import {
	postCreateSession,
	postCheckParticipantCode,
	getParticipantConfig,
	postEvent,
	getParticipantChannelSource,
} from './common/clientRoutes';

import {
	deleteFromLocalStorage,
	deleteFromSessionStorage,
	getFromLocalStorage,
	getFromSessionStorage,
	saveToLocalStorage,
	saveToSessionStorage,
	cleanStorage,
	log,
} from './lib';

export type Api = {
	addOnLogoutListener: (listener: () => void) => void;
	sendPageView: () => void;
	setTabActive: (active: boolean | undefined) => void;
	createSession: () => Promise<Maybe<Session>>;
	checkParticipantCode: (participantCode: string) => Promise<boolean>;
	setAuth: (participantCode: string) => void;
	getAuth: () => string;
	newSession: () => Promise<string>;
	getSession: () => string | undefined;
	ensureSession: () => Promise<void>;
	getConfig: () => Promise<Maybe<ParticipantConfig>>;
	postEvent: (event: Event, storeForRetry: boolean) => Promise<boolean>;
	getHeaders: () => Record<string, string>;
	getChannelSource: (force?: boolean) => Promise<string>;
	logout(): void;
};

type StoredEvent = {
	apiUrl: string;
	event: Event;
	lastAttempt: Date;
	persisted: boolean;
	attempts: number;
	participantCode: string;
	tryImmediately: boolean;
};

const retryDelay = 60000;
const eventsStorageKey = 'events';
let tabIsActive: boolean | undefined;

const loadStoredEvents = () => {
	const dataStr = getFromLocalStorage(eventsStorageKey);

	if (!dataStr) {
		return [];
	}

	const json = getFromLocalStorage('lz-string') === 'true'
		? decompressFromUTF16(dataStr)
		: dataStr;

	if (!json) {
		return [];
	}

	return (JSON.parse(json) as StoredEvent[]).map(e => ({
		...e,
		// Need to restore the Date which will not be properly deserialized
		lastAttempt: new Date(e.lastAttempt),
	}));
};

const saveStoredEvents = (events: StoredEvent[]) => {
	try {
		saveToLocalStorage('lz-string', 'true');
		const data = compressToUTF16(JSON.stringify(events));
		saveToLocalStorage(eventsStorageKey, data);
	} catch (e) {
		log('error', 'Failed to store events locally, forgetting about them...', e);
		saveToLocalStorage(eventsStorageKey, '');
	}
};

const retryToPostStoredEvents = async () => {
	const storedEvents = loadStoredEvents();

	for (const storedEvent of storedEvents) {
		const latestAttempt = Number(new Date(storedEvent.lastAttempt));
		const timeUntilNextAttempt = latestAttempt + retryDelay - Date.now();
		if (timeUntilNextAttempt > 0 && !storedEvent.tryImmediately) {
			continue;
		}

		storedEvent.attempts += 1;
		storedEvent.tryImmediately = false;

		const api = createApi(storedEvent.apiUrl, storedEvent.participantCode);

		const {'X-Participant-Code': participantCode} = api.getHeaders();

		if (!participantCode) {
			storedEvent.persisted = true;
			continue;
		}

		// eslint-disable-next-line no-await-in-loop
		const result = await api.postEvent(storedEvent.event, false);
		if (result) {
			storedEvent.persisted = true;
		} else {
			storedEvent.lastAttempt = new Date();
		}
	}

	const remainingEvents = storedEvents.filter(e => !e.persisted);

	saveStoredEvents(remainingEvents);
};

const clearStoredEvent = (event: Event) => {
	const events = loadStoredEvents();

	const newEvents = events.filter(e => e.event.localUuid !== event.localUuid);
	saveStoredEvents(newEvents);
};

export const createApi = (apiUrl: string, overrideParticipantCode?: string): Api => {
	let participantCode = getFromLocalStorage('participantCode') ?? overrideParticipantCode ?? '';
	let sessionUuid = getFromSessionStorage('sessionUuid') ?? '';
	let sessionPromise: Promise<Maybe<Session>> | undefined;

	const onLogOutListeners: Array<() => void> = [];

	const storeEvent = (event: Event) => {
		const storedEvents = loadStoredEvents();

		const toStore = {
			event,
			apiUrl,
			lastAttempt: new Date(),
			persisted: false,
			attempts: 1,
			participantCode,
			tryImmediately: true,
		};

		storedEvents.push(toStore);

		saveStoredEvents(storedEvents);
	};

	const headers = () => ({
		'Content-Type': 'application/json',
		'X-Participant-Code': participantCode,
	});

	const verb = makeApiVerbCreator(apiUrl);

	const post = verb('POST');
	const get = verb('GET');

	const getConfig = async () => get<ParticipantConfig>(getParticipantConfig, {}, headers());

	const api: Api = {
		async createSession() {
			if (sessionPromise) {
				return sessionPromise;
			}

			const p = post<Session>(postCreateSession, {}, headers());
			sessionPromise = p;

			p.then(() => {
				sessionPromise = undefined;
			}).catch(e => {
				log('error', 'failed to create session:', e);
				sessionPromise = undefined;
			});

			return p;
		},

		async checkParticipantCode(code: string) {
			const result = await post<boolean>(postCheckParticipantCode, {code}, headers());

			if (result.kind !== 'Success') {
				return false;
			}

			return true;
		},

		setAuth(code: string) {
			saveToLocalStorage('participantCode', code);
			participantCode = code;
		},

		getAuth() {
			return participantCode;
		},

		async newSession() {
			if (!participantCode) {
				throw new Error('Missing participant code!');
			}

			const res = await this.createSession();

			if (res.kind === 'Success') {
				sessionUuid = res.value.uuid;
				saveToSessionStorage('sessionUuid', sessionUuid);
				return res.value.uuid;
			}

			throw new Error('Failed to create new session: ' + res.message);
		},

		getSession() {
			return sessionUuid === '' ? undefined : sessionUuid;
		},

		getConfig,

		async ensureSession() {
			if (sessionUuid !== '') {
				return;
			}

			if (sessionPromise) {
				await sessionPromise;
				return;
			}

			await this.newSession();
		},

		async postEvent(inputEvent: Event, storeForRetry: boolean) {
			const h = headers();

			if (!h['X-Participant-Code']) {
				log('Missing participant code!');
				return false;
			}

			const event = {
				...inputEvent,
				context: inputEvent.context ?? document.referrer,
			};

			event.extensionVersion = packageJson.version;
			event.tabActive = tabIsActive;

			if (event.sessionUuid === '') {
				await this.ensureSession();
				event.sessionUuid = sessionUuid;
			}

			if (storeForRetry) {
				storeEvent(event);
			}

			if (!event.url) {
				event.url = window.location.href;
			}

			const res = await post<boolean>(postEvent, event, h);

			if (res.kind === 'Success') {
				clearStoredEvent(event);
				return true;
			}

			if (res.kind === 'Failure' && res.code === 'EVENT_ALREADY_EXISTS_OK') {
				clearStoredEvent(event);
				return true;
			}

			return false;
		},

		getHeaders() {
			return headers();
		},

		logout() {
			deleteFromLocalStorage('participantCode');
			deleteFromLocalStorage(eventsStorageKey);
			deleteFromSessionStorage('sessionUuid');
			deleteFromSessionStorage('cfg');
			participantCode = '';
			sessionUuid = '';
			cleanStorage();

			for (const listener of onLogOutListeners) {
				listener();
			}
		},

		sendPageView() {
			const event = new Event();

			event.type = EventType.PAGE_VIEW;
			event.url = window.location.href;

			if (!event.context) {
				event.context = document.referrer;
			}

			api.postEvent(event, true).catch(e => {
				log('Failed to send page view event', event.localUuid, 'will be retried later on:', e);
			});
		},

		setTabActive(active: boolean | undefined) {
			tabIsActive = active;
		},

		async getChannelSource(force = false) {
			const params = force
				? {force: 'true'}
				: {};

			const res = await get<ParticipantChannelSource>(getParticipantChannelSource, params, headers());

			if (res.kind !== 'Success') {
				throw new Error(`Failed to get channel source: ${res.message}`);
			}

			return res.value.channelId;
		},

		addOnLogoutListener(listener: () => void) {
			onLogOutListeners.push(listener);
		},
	};

	return api;
};

setInterval(retryToPostStoredEvents, retryDelay);
retryToPostStoredEvents().catch(e => {
	log('error', 'failed to retry to post stored events', e);
});
