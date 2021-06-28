# coding: utf-8
lib = File.expand_path('../lib', __FILE__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'rake'
require 'envkey/version'

gem_name = "envkey"
summary = "Envkey secures and simplifies app secrets and config."

override_name = ENV["ENVKEY_DEV_OVERRIDE_PACKAGE_NAME"]
if override_name
  puts "overriding gem publish name from '#{gem_name}' to '#{override_name}'"
  gem_name = override_name
  summary = "publish testing package - do not use"
end

Gem::Specification.new do |spec|
  spec.name          = gem_name
  spec.version       = Envkey::VERSION
  spec.authors       = ["Dane Schneider"]
  spec.email         = ["dane@envkey.com"]

  spec.summary       = summary
  spec.homepage      = "https://www.envkey.com"
  spec.license       = "MIT"

  # Prevent pushing this gem to RubyGems.org. To allow pushes either set the 'allowed_push_host'
  # to allow pushing to a single host or delete this section to allow pushing to any host.
  if spec.respond_to?(:metadata)
    spec.metadata['allowed_push_host'] = "https://rubygems.org"
  else
    raise "RubyGems 2.0 or newer is required to protect against " \
      "public gem pushes."
  end

  spec.files         = FileList['bin/*',
                                'ext/**/*',
                                'lib/**/*.rb',
                                'envkey.gemspec',
                                'Gemfile',
                                'LICENSE.txt',
                                'README.md',
                                'version.txt'].to_a
  puts "Gem files: #{spec.files}"
  spec.bindir        = "exe"
  spec.executables   = spec.files.grep(%r{^exe/}) { |f| File.basename(f) }
  spec.require_paths = ["lib"]

  spec.add_development_dependency "bundler", "~> 1.13"
  spec.add_development_dependency "rake", "~> 10.0"
  spec.add_development_dependency "rspec", "~> 3.0"

  spec.add_runtime_dependency "dotenv", "~> 2.0"
end
