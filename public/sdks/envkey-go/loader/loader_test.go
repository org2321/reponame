package loader_test

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/envkey/go-sdk/loader"
)

const VALID_ENVKEY = "2L9Xy76BkmawqLUkw7Pah6jQHU-4KcNqgRHVTx2UxRpL8Uf7hxP12-api-v2-staging.envkey.com"
const INVALID_ENVKEY = "Emzt4BE7C23QtsC7gb1z-3NvfNiG1Boy6XH2oinvalid-api-v2-staging.envkey.com"

func TestLoadMissing(t *testing.T) {
	os.Clearenv()
	assert.Panics(t, func() { loader.Load(false) })
}

func TestLoadValid(t *testing.T) {
	os.Clearenv()
	os.Setenv("ENVKEY", VALID_ENVKEY)
	assert.NotPanics(t, func() { loader.Load(false) })
	assert.Equal(t, "it", os.Getenv("TEST"))
	assert.Equal(t, "works!", os.Getenv("TEST_2"))
}

func TestLoadInvalid(t *testing.T) {
	os.Clearenv()
	os.Setenv("ENVKEY", INVALID_ENVKEY)
	assert.Panics(t, func() { loader.Load(false) })
}

func TestLoadOverrides(t *testing.T) {
	os.Clearenv()
	os.Setenv("ENVKEY", VALID_ENVKEY)
	os.Setenv("TEST_2", "override")
	assert.NotPanics(t, func() { loader.Load(false) })
	assert.Equal(t, "it", os.Getenv("TEST"))
	assert.Equal(t, "override", os.Getenv("TEST_2"))
}
