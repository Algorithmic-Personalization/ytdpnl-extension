# Building the extension

## Pre-requisites

Any OS should do, but the following was tested under Ubuntu 22.10.

You will need to have a recent (>= 16.18.1) version of [Node.js](https://nodejs.org/en/) and
have the [yarn](https://yarnpkg.com/) package manager installed globally.

### Building from GitHub

## Clone the repository recursively (with submodules)

In the terminal:

`git clone https://github.com/Algorithmic-Personalization/ytdpnl-extension.git --recursive`

In order to be sure to get the version corresponding to the submitted extension,
please checkout this commit for v3.6.1:

```bash
cd ytdpnl-extension
git checkout 1ba706058
```

## Install the dependencies

```
yarn
```

## Build the extension
Create a configuration file and build.

```bash
cp config.extension.dist.ts config.extension.ts
yarn build
```
Change the development server to your server's development URL.

The extension will be output in the `dist` folder.

### Building from the source .zip

If what was submitted to you for review was a zip package, the code is self-contained and the submitted archive zip is included for hash comparison.
Build instructions are the same as above, just no need to clone the repository, just extract the zip.
