# EnvKey SDKs

EnvKey uses semantic versioning. The SDKs wrap `envkey-fetch`.

All EnvKey SDK clients follow the major and minor versions updates to `envkey-fetch`.

Additional fixes to SDKs, such as non-breaking dependency updates, may iterate the patch version.

## Go projects and modules

`envkey-fetch` is a dependency of the other go projects herein. We publish it to a mirror repo to make it easier to consume: `github.com/envkey/go-envkeyfetch`.

### Go Toolchain Installation

We try to keep EnvKey Golang projects on the latest version of Go. Each project has a `go.mod` file which shows the version of the `go` binary used to build it. `goreleaser` is also intended to be kept up to date. As a result, it may be better to avoid `brew` on macOS. Prefer installing the latest as follows:

- golang.org Go installer
- goreleaser `go install github.com/goreleaser/goreleaser@latest`

### Upgrading go and mod

Change the Go version line in go.mod.
Run `go mod tidy`.

Change the module versions desired in go.mod. Run `go mod download`.
