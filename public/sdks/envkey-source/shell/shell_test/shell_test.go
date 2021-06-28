package shell_test

import (
	"testing"

	"github.com/envkey/go-envkeyfetch/fetch"
	"github.com/org2321/reponame/public/sdks/envkey-source/shell"
	"github.com/org2321/reponame/public/sdks/envkey-source/version"
	"github.com/stretchr/testify/assert"
)

const VALID_ENVKEY = "2L9Xy76BkmawqLUkw7Pah6jQHU-4KcNqgRHVTx2UxRpL8Uf7hxP12-api-v2-staging.envkey.com"
const INVALID_ENVKEY = "Emzt4BE7C23QtsC7gb1z-3NvfNiG1Boy6XH2oinvalid-api-v2-staging.envkey.com"

func TestSource(t *testing.T) {
	// Test valid
	validRes := shell.Source(VALID_ENVKEY, true, fetch.FetchOptions{false, "", "envkey-source", version.Version, false, 2.0, 1, 0.1}, false, false)
	assert.Equal(t, "export 'TEST'='it' 'TEST_2'='works!' 'TEST_INJECTION'=''\"'\"'$(uname)' 'TEST_SINGLE_QUOTES'='this'\"'\"' is ok' 'TEST_SPACES'='it does work!' 'TEST_STRANGE_CHARS'='with quotes ` '\"'\"' \\\" bäh'", validRes)

	// Test --pam-compatible
	validRes2 := shell.Source(VALID_ENVKEY, true, fetch.FetchOptions{false, "", "envkey-source", version.Version, false, 2.0, 1, 0.1}, true, false)
	assert.Equal(t, "export TEST='it'\nexport TEST_2='works!'\nexport TEST_INJECTION=''$(uname)'\nexport TEST_SINGLE_QUOTES='this' is ok'\nexport TEST_SPACES='it does work!'\nexport TEST_STRANGE_CHARS='with quotes ` ' \\\" bäh'", validRes2)

	// Test --dot-env-compatible
	validRes3 := shell.Source(VALID_ENVKEY, true, fetch.FetchOptions{false, "", "envkey-source", version.Version, false, 2.0, 1, 0.1}, false, true)
	assert.Equal(t, "TEST='it'\nTEST_2='works!'\nTEST_INJECTION=''\"'\"'$(uname)'\nTEST_SINGLE_QUOTES='this'\"'\"' is ok'\nTEST_SPACES='it does work!'\nTEST_STRANGE_CHARS='with quotes ` '\"'\"' \\\" bäh'\n", validRes3)

	// Test --verbose flag
	assert.NotPanics(t, func() {
		shell.Source(VALID_ENVKEY, true, fetch.FetchOptions{false, "", "envkey-source", version.Version, true, 2.0, 1, 0.1}, false, false)
	})

	// Test invalid
	invalidRes := shell.Source(INVALID_ENVKEY, true, fetch.FetchOptions{false, "", "envkey-source", version.Version, false, 2.0, 1, 0.1}, false, false)
	assert.Equal(t, "echo 'error: ENVKEY invalid'; false", invalidRes)
}
