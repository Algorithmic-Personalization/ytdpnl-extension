import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import {
	Box,
	IconButton,
	Typography,
} from '@mui/material';

import {Close as CloseIcon} from '@mui/icons-material';

import {getThemeContrastBackgroundColor, getThemeContrastTextColor} from '../theme';

import {type SubAppCreator, type SubAppState, ReactAdapter} from '../SubApp';

import MessageC from '../components/MessageC';
import {getFromLocalStorage} from '../lib';
import {useApi} from '../apiProvider';

const LoginApp: React.FC<SubAppState & {
	triggerUpdate: (newState: Partial<SubAppState>) => void;
	log: (...args: any[]) => void;
}> = ({
	loggedInExtension,
	loggedInYouTube,
	triggerUpdate,
	log,
}) => {
	const [shown, setShown] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [code, setCode] = useState(getFromLocalStorage('participantCode') ?? '');

	const api = useApi();

	if (loggedInExtension && loggedInYouTube) {
		return null;
	}

	if (!shown) {
		return null;
	}

	const hide = () => {
		setShown(false);
		setTimeout(() => {
			setShown(true);
		}, 1000 * 60 * 5);
	};

	useEffect(() => {
		const kbListener = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				hide();
			}
		};

		document.addEventListener('keydown', kbListener);

		return () => {
			document.removeEventListener('keydown', kbListener);
		};
	}, []);

	return (
		<Box
			sx={{
				position: 'absolute',
				zIndex: 10000,
				top: 0,
				bottom: 0,
				left: 0,
				right: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
			}}
		>
			<Box sx={{
				backgroundColor: getThemeContrastBackgroundColor(),
				color: getThemeContrastTextColor(),
				padding: 4,
				borderRadius: 4,
			}}>
				<Box sx={{textAlign: 'right'}}>
					<IconButton
						size='large'
						onClick={hide}
						sx={{
							color: getThemeContrastTextColor(),
						}}
					>
						<CloseIcon />
					</IconButton>
				</Box>
				<Typography variant='h4' sx={{m: 2, color: getThemeContrastTextColor()}}>
					Welcome to the YouTube Experiment extension!
				</Typography>
				{((!loggedInYouTube) && (<Box>
					<Typography sx={{m: 2, color: getThemeContrastTextColor()}}>
						Please log in to YouTube to use the YouTube Experiment extension.
					</Typography>
					<Typography
						onClick={hide}
						sx={{
							color: getThemeContrastTextColor(),
							m: 2,
							mb: 4,
							fontSize: '1rem',
							cursor: 'pointer',
							textDecoration: 'underline',
						}}>
						You can close this window and use YouTube&apos;s login button.
					</Typography>
				</Box>))}
				{((!loggedInExtension) && <Box sx={{
					color: getThemeContrastTextColor(),
					p: 2,
				}}>
					<Typography sx={{
						color: getThemeContrastTextColor(),
						mb: 1,
					}}>
						Please log in to the extension with your participant code to use the YouTube Experiment extension.
					</Typography>

					<form onSubmit={async e => {
						log('submitting extension login form');
						e.preventDefault();
						api.setAuth(code);
						const maybeConfig = await api.getConfig();

						if (maybeConfig.kind !== 'Success') {
							setError('Failed to get configuration, please make sure your participant code is valid or try again later.');
							return;
						}

						const {value: config} = maybeConfig;

						if (!config) {
							setError('No configuration found in server response :(');
							return;
						}

						api.newSession().then(s => {
							log('New session created:', s);
							api.sendPageView();
						}, e => {
							log('error', 'error creating new session:', e);
						});

						triggerUpdate({
							config,
						});
					}}>
						<Typography sx={{color: getThemeContrastTextColor()}}>
							Participant code:
						</Typography>

						<input
							style={{
								display: 'block',
								width: '100%',
								padding: '1rem',
								borderRadius: 2,
								marginTop: 2,
								marginBottom: 2,
								border: '1px solid #ccc',
								outline: 'none',
							}}
							value={code}
							onChange={e => {
								setCode(e.target.value);
							}}
						/>

						<Typography sx={{
							fontSize: '1rem',
							color: getThemeContrastTextColor(),
							mb: 2,
						}}>
							This is the code that has been give to you by e-mail.
						</Typography>

						<Box sx={{mt: 2}}>
							<button type='submit' style={{padding: 2}}>
								Submit
							</button>
						</Box>

						<MessageC message={error} type='error' sx={{
							width: '100%',
							borderRadius: 1,
							mt: 2,
							mb: 0,
						}}/>
					</form>
				</Box>)}
			</Box>
		</Box>
	);
};

export const loginApp: SubAppCreator = ({api, getElement, triggerUpdate, log}) => {
	const rootElt = document.createElement('div');
	rootElt.id = 'ytdpnl-extension-login-app';

	const root = createRoot(rootElt);

	const render = (state: SubAppState) => {
		const App = (
			<ReactAdapter api={api}>
				<LoginApp {...{...state, triggerUpdate, log}} />
			</ReactAdapter>
		);

		root.render(App);
	};

	return {
		getName() {
			return 'loginApp';
		},
		async onUpdate(state) {
			if (!document.querySelector(rootElt.id)) {
				const target = await getElement('body');
				target.prepend(rootElt);
			}

			render(state);

			return [rootElt];
		},
		onDestroy(elt) {
			console.log('Destroying login app');
			root.unmount();
			elt.remove();
		},
	};
};

export default loginApp;
