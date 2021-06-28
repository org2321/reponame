# envkey-v2

## Verification

For each release artifact, EnvKey publishes a checksum and code signature. The code signature can be verified with a public key published on our website. [TODO LINK TO PUB KEY](). The checksum can be verified with standard OS tooling.

### Quick Verification

Install [`minisign` &rarr;](https://jedisct1.github.io/minisign/).


```
url=< set to the download link>

curl -O $url -O $url.minisig && minisign -Vm $(basename $url) -P "RWSDdMhnheAKG+5OmfSK8IRYobwafgb8AEZfYgatymgWeHBoqvr+I4uG"
```

*This downloads the file and its signature (`.minisig`), then confirms it with `minisign`*

It will print `Signature and comment signature verified` if successful.

### Extended Guide: Verifying Signed Artifacts

1. Install [`minisign` &rarr;](https://jedisct1.github.io/minisign/).

2. Obtain the EnvKey public code signing key:
    ```bash
    curl <TODO LINK TO PUBLIC KEY> > envkey.pub
    ```

3. Download the release file. In this example, it will be a fake version of the CLI.
   ```bash
   curl \
     -o envkey-cli.tar.gz \
     https://envkey-releases.s3.amazonaws.com/cli/release_artifacts/0.1.26/envkey-cli_0.1.26_linux_amd64.tar.gz
   ```
4. Download the signature file. It has the same URL with the addition of `.minisig`.
   ```bash
   curl \
     -o envkey-cli.tar.gz.minisig \
     https://envkey-releases.s3.amazonaws.com/cli/release_artifacts/0.1.26/envkey-cli_0.1.26_linux_amd64.tar.gz.minisig
   ```
   It should look something like:
   ```
   untrusted comment: signature from minisign secret key
   RUSDdMhnheAKG8VYidp2sEJbKmRthLmP77TH/Pdi6Pzrl5nvdDGFx7tRC38jF/IVqZg+8T7G34c0RA5+XPnTm058w9VFo6XhDgs=
   trusted comment: timestamp:1621025666	file:906c3a5aca6541cca100dc2537e7c5f8
   ```
5. Verify the downloaded file.
   ```bash
   minisign -V \
     -p envkey.pub \
     -x envkey-cli.tar.gz.minisig \
     -m envkey-cli.tar.gz 
   ```

Upon success, it should print something like:

```
Signature and comment signature verified
Trusted comment: timestamp:1621024971   file:5iFSsQ1kgfs23vpe
```


### Extended Guide: Verifying Artifact Checksums

A SHA-512 sum is published for each artifact at the same filename + `.sha512`.

For example, consider a fake desktop app release from EnvKey. The app can be downloaded from our release website:

```
https://envkey-releases.s3.amazonaws.com/desktop/release_artifacts/0.0.95/EnvKey-0.0.95.dmg
```

Its checksum would be published at:

```
https://envkey-releases.s3.amazonaws.com/desktop/release_artifacts/0.0.95/EnvKey-0.0.95.dmg.sha512
``` 

Example of a SHA-512 checksum:
```
a7142ffe07f1a068cb5fe32d318a3a65ca6ddcdef3a5614216ac64f4920c82001a57a32879a86f961fbf4228b0b0378d26718edf07e9333e9b8b4ce51a4b4ad3
```

Print the checksum on mac:
```bash
sha512sum EnvKey-0.0.95.dmg | xxd -r -p | base64
```

Print the checksum on linux:
```bash
sha512sum EnvKey-0.0.95.AppImage | xxd -r -p | base64
```

On posix systems, it may be easier to just download the `shasums.txt` file for the release, and
compare it to your local download. Plus, `shasums.txt.minisig` is available for signature verification.

```bash
minisign -Vm shasums.txt && sha512sum --check shasums.txt
```

Microsoft includes a has a GUI tool "Microsoft File Checksum Integrity Verifier" in Windows Powershell which can be used
to obtain the SHA-512 hash:

Or Powershell:
```bash
get-filehash -Algorithm SHA512 "EnvKey_Windows_Installer-0.0.95.exe"
```

