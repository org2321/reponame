// Copyright © 2021 Envkey Inc <support@envkey.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package cmd

import (
	"fmt"
	"os"

	"github.com/envkey/go-envkeyfetch/fetch"
	"github.com/envkey/go-envkeyfetch/version"

	"github.com/spf13/cobra"
)

var cacheDir string
var shouldCache bool
var printVersion bool
var verboseOutput bool
var clientName string
var clientVersion string
var timeoutSeconds float64
var retries uint8
var retryBackoff float64

// RootCmd represents the base command when called without any subcommands
var RootCmd = &cobra.Command{
	Use:   "envkey-fetch YOUR-ENVKEY",
	Short: "Fetches, decrypts, and verifies EnvKey config. Accepts a single envkey as an argument. Returns decrypted config as json. Can optionally cache encrypted config locally.",
	Run: func(cmd *cobra.Command, args []string) {
		if printVersion {
			fmt.Println(version.Version)
			return
		}

		if len(args) > 0 {
			res, err := fetch.Fetch(args[0], fetch.FetchOptions{shouldCache, cacheDir, clientName, clientVersion, verboseOutput, timeoutSeconds, retries, retryBackoff})
			if err != nil {
				fmt.Fprintln(os.Stderr, "error: "+err.Error())
				os.Exit(1)
			} else {
				fmt.Println(res)
				os.Exit(0)
			}
		} else {
			cmd.Help()
		}
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := RootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func init() {
	RootCmd.Flags().BoolVar(&shouldCache, "cache", false, "cache encrypted config as a local backup (default is false)")
	RootCmd.Flags().StringVar(&cacheDir, "cache-dir", "", "cache directory (default is $HOME/.envkey/cache)")
	RootCmd.Flags().StringVar(&clientName, "client-name", "", "calling client library name (default is none)")
	RootCmd.Flags().StringVar(&clientVersion, "client-version", "", "calling client library version (default is none)")
	RootCmd.Flags().BoolVarP(&printVersion, "version", "v", false, "prints the version")
	RootCmd.Flags().BoolVar(&verboseOutput, "verbose", false, "print verbose output (default is false)")
	RootCmd.Flags().Float64Var(&timeoutSeconds, "timeout", 20.0, "timeout in seconds for http requests")
	RootCmd.Flags().Uint8Var(&retries, "retries", 3, "number of times to retry requests on failure")
	RootCmd.Flags().Float64Var(&retryBackoff, "retryBackoff", 1, "retry backoff factor: {retryBackoff} * (2 ^ {retries - 1})")
}
