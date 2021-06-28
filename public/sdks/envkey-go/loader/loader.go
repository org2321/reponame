package loader

import (
	"encoding/json"
	"errors"
	"os"

	"github.com/envkey/go-envkeyfetch/fetch"
	"github.com/joho/godotenv"
)

func Load(shouldCache bool) {
	godotenv.Load()
	envkey := os.Getenv("ENVKEY")

	if envkey == "" {
		panic(errors.New("missing ENVKEY"))
	}

	res, err := fetch.Fetch(envkey, fetch.FetchOptions{shouldCache, "", "envkeygo", "", false, 15.0, 3, 1})

	if err != nil {
		panic(err)
	}

	var resMap map[string]string
	err = json.Unmarshal([]byte(res), &resMap)

	if err != nil {
		panic(errors.New("problem parsing EnvKey's response"))
	}

	for k, v := range resMap {
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}
