import React, {useState, useRef, useEffect} from 'react';
import {Typography} from '@mui/material';

import type Recommendation from '../common/types/Recommendation';
import {imageExists, log} from '../lib';

export const getHomeMiniatureUrl = (videoId: string) =>
	`https://i.ytimg.com/vi/${videoId}/hq720.jpg`;

export const HomeVideoCard: React.FC<Recommendation & {
	onClick: () => void;
	onPictureLoaded?: () => void;
	onPictureErrored?: () => void;
}> = ({
	videoId,
	channelName,
	title,
	views,
	publishedSince,
	channelShortName,
	miniatureUrl,
	channelMiniatureUrl,
	hoverAnimationUrl,
	onClick,
	onPictureLoaded,
	onPictureErrored,
}) => {
	const [isHovering, setHovering] = useState(false);

	const imgRef = useRef<HTMLImageElement>(null);

	const candidateMiniatureUrls = [
		getHomeMiniatureUrl(videoId),
		miniatureUrl,
	];

	const [pictureUrl, setPictureUrl] = useState<string | undefined>(candidateMiniatureUrls[0]);

	const mediaLink = isHovering && hoverAnimationUrl
		? hoverAnimationUrl
		: pictureUrl;

	useEffect(() => {
		(async () => {
			const picExists = await imageExists(candidateMiniatureUrls[0]);

			if (picExists) {
				onPictureLoaded?.();
			} else {
				onPictureErrored?.();
			}

			if (!picExists) {
				setPictureUrl(candidateMiniatureUrls[1]);
			}
		})().catch(e => {
			log('error', 'failed to check whether image exists:', e);
		});
	});

	return (
		<section className='style-scope ytd-rich-grid-row' onClick={onClick}>
			<div
				className='style-scope ytd-rich-item-renderer'
				onMouseEnter={() => {
					setHovering(true);
				}}
				onMouseLeave={() => {
					setHovering(false);
				}}
			>
				<div
					id='thumbnail'
					className='style-scope ytd-rich-grid-media'
				>
					<div className='style-scope ytd-rich-grid-media'>
						<a
							className='yt-simple-endpoint inline-block style-scope ytd-thumbnail'
							href={`/watch?v=${videoId}`}
						>
							<div className='style-scope ytd-thumbnail'>
								{(!isHovering && <img
									style={{
										backgroundColor: 'transparent',
										borderRadius: 12,
									}}
									className='yt-core-image--fill-parent-height yt-core-image--fill-parent-width yt-core-image yt-core-image--content-mode-scale-aspect-fill yt-core-image--loaded'
									src={mediaLink}
									ref={imgRef}
									onLoad={onPictureLoaded}
									onError={onPictureErrored}
								/>)}
								<img
									style={{
										backgroundColor: 'transparent',
										borderRadius: 12,
										display: isHovering ? 'block' : 'none',
										...(imgRef.current ? {
											width: imgRef.current.width,
											height: imgRef.current.height,
										} : {}),
									}}
									className='yt-core-image--fill-parent-height yt-core-image--fill-parent-width yt-core-image yt-core-image--content-mode-scale-aspect-fill yt-core-image--loaded'
									src={mediaLink}
								/>
							</div>
						</a>
					</div>
				</div>
				<div id='details' className='style-scope ytd-rich-grid-media'>
					<a
						id='avatar-link'
						href={channelShortName}
						title={channelName}
						className='yt-simple-endpoint style-scope ytd-rich-grid-media'
					>
						<div className='style-scope ytd-rich-grid-media no-transition'>
							<img
								width={48}
								className='style-scope yt-img-shadow'
								src={channelMiniatureUrl}
								style={{borderRadius: '50%'}}
							/>
						</div>
					</a>
					<div id='meta' className='style-scope ytd-rich-grid-media'>
						<h3 className='style-scope ytd-rich-grid-media'>
							<a
								className='yt-simple-endpoint focus-on-expand style-scope ytd-rich-grid-media'
								href={`/watch?v=${videoId}`}
								title={title}
							>
								<div className='style-scope ytd-rich-grid-media'>
									<Typography variant='h3' component='h3'>
										{title}
									</Typography>
								</div>
							</a>
						</h3>
						<div className='grid style-scope ytd-rich-grid-media byline-separated'>
							<div id='metadata' className='style-scope ytd-video-meta-block' style={{
								flexDirection: 'column',
							}}>
								<div id='byline-container' className='style-scope ytd-video-meta-block'>
									<div className='style-scope ytd-video-meta-block'>
										<div id='container' className='style-scope ytd-channel-name'>
											<Typography variant='body2' component='a'>
												{channelName}
											</Typography>
										</div>
									</div>
								</div>
								<div id='metadata-line' className='style-scope ytd-video-meta-block'>
									<Typography variant='body2' component='span'>
										{views}&nbsp;•&nbsp;{publishedSince}
									</Typography>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
};

export default HomeVideoCard;
