# slicedrop-cli

Local CLI for turning a NIfTI file into a shareable SliceDrop URL.

For the initial POC, storage is Dropbox only. Files are uploaded into the
user's Dropbox app folder, then the CLI prints a SliceDrop viewer URL.

## Quick Start

Authorize Dropbox once:

```bash
slicedrop auth dropbox
```

Share a scan:

```bash
slicedrop share brain.nii.gz
```

Example output:

```txt
https://slicedrop.github.io/reloaded/?url=<dropbox-direct-download-url>&name=brain.nii.gz
```

## Dropbox App

The CLI defaults to the SliceDrop Dropbox app key:

```txt
56ojxezej9ocwcw
```

To use your own Dropbox app instead:

```bash
slicedrop auth dropbox --app-key your-dropbox-app-key
```

Or save the app key locally:

```bash
slicedrop config set dropbox-app-key your-dropbox-app-key
```

The saved config lives at:

```txt
C:\Users\USER\.slicedrop\config.json
```

The Dropbox token lives at:

```txt
C:\Users\USER\.slicedrop\dropbox-token.json
```

## Optional Folder

By default, uploads go into the root of the Dropbox app folder. You can set a
subfolder:

```bash
slicedrop config set dropbox-root-folder /Uploads
slicedrop share brain.nii.gz
```

## Duplicate Files

Uploads are content-addressed by SHA-256. If the exact same file is shared
again, the CLI reuses the existing Dropbox file instead of uploading another
copy.
