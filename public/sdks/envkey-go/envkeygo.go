package envkeygo

import (
	"os"

	"github.com/envkey/go-sdk/loader"
)

func init() {
	shouldCache := false
	if _, err := os.Stat(".env"); !os.IsNotExist(err) {
		shouldCache = true
	}

	loader.Load(shouldCache)
}
