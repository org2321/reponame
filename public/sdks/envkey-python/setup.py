import os
from setuptools import setup

package_name = "envkey"
description = "EnvKey's Python library. Protect API keys and credentials. Keep configuration in sync."
override_name = os.environ.get("ENVKEY_DEV_OVERRIDE_PACKAGE_NAME")
if override_name:
    print("overriding package publish name from '" + package_name + "' to '" + override_name + "'")
    package_name = override_name
    description = "publish testing package - do not use"

version = ""
with open("version.txt", "r") as version_file:
    version = version_file.read()
print("package version will be " + version)

long_description = ""
with open('README.md') as f:
    long_description = f.read()
if override_name:
    long_description = "# " + description + "\n\n" + long_description

setup(name=package_name,
      version=version.strip(),
      description=description,
      long_description=long_description,
      long_description_content_type='text/markdown',
      # TODO: update envkey repo for production
      url="https://github.com/org2321/reponame",
      keywords=["security", "secrets management", "configuration management", "environment variables", "configuration",
                "python"],
      author="EnvKey",
      author_email="support@envkey.com",
      license="MIT",
      packages=["envkey"],
      package_data={"envkey": ["ext/?/*"]},
      include_package_data=True,
      install_requires=["python-dotenv>=0.13.0"],
      classifiers=[
          "Development Status :: 5 - Production/Stable",
          "Intended Audience :: Developers",
          "Intended Audience :: System Administrators",
          "License :: OSI Approved :: MIT License",
          "Programming Language :: Python :: 2",
          "Programming Language :: Python :: 3",
          "Topic :: Security",
          "Topic :: Security :: Cryptography",
      ],
      zip_safe=False)
