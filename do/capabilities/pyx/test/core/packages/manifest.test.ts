import { describe, it, expect } from 'vitest'
import {
  parsePyprojectToml,
  parseRequirementsTxt,
  parseVersionSpecifier,
  parsePythonVersionConstraint,
  extractPackageMetadata,
} from '../../../core/packages'

// =============================================================================
// pyproject.toml Parsing (PEP 517/518/621)
// =============================================================================

describe('parsePyprojectToml', () => {
  describe('[project] section (PEP 621)', () => {
    it('parses name and version', () => {
      const toml = `
[project]
name = "my-package"
version = "1.2.3"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.name).toBe('my-package')
      expect(result.project?.version).toBe('1.2.3')
    })

    it('parses dependencies list', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
dependencies = [
  "requests>=2.28.0",
  "numpy~=1.24.0",
  "pandas[excel,sql]>=2.0.0,<3.0.0"
]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.dependencies).toHaveLength(3)
      expect(result.project?.dependencies?.[0]).toBe('requests>=2.28.0')
      expect(result.project?.dependencies?.[1]).toBe('numpy~=1.24.0')
      expect(result.project?.dependencies?.[2]).toBe('pandas[excel,sql]>=2.0.0,<3.0.0')
    })

    it('parses requires-python constraint', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
requires-python = ">=3.9"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.requiresPython).toBe('>=3.9')
    })

    it('parses description and readme', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
description = "A sample package"
readme = "README.md"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.description).toBe('A sample package')
      expect(result.project?.readme).toBe('README.md')
    })

    it('parses license', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
license = {text = "MIT"}
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.license).toEqual({ text: 'MIT' })
    })

    it('parses authors and maintainers', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
authors = [
  {name = "John Doe", email = "john@example.com.ai"},
  {name = "Jane Doe"}
]
maintainers = [
  {email = "maintainer@example.com.ai"}
]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.authors).toHaveLength(2)
      expect(result.project?.authors?.[0]).toEqual({ name: 'John Doe', email: 'john@example.com.ai' })
      expect(result.project?.maintainers).toHaveLength(1)
    })

    it('parses keywords and classifiers', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
keywords = ["python", "packaging", "tools"]
classifiers = [
  "Development Status :: 4 - Beta",
  "Programming Language :: Python :: 3.9"
]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.keywords).toEqual(['python', 'packaging', 'tools'])
      expect(result.project?.classifiers).toHaveLength(2)
    })

    it('parses urls', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.urls]
Homepage = "https://example.com.ai"
Documentation = "https://docs.example.com.ai"
Repository = "https://github.com/example/my-package"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.urls?.Homepage).toBe('https://example.com.ai')
      expect(result.project?.urls?.Repository).toBe('https://github.com/example/my-package')
    })

    it('parses scripts and gui-scripts', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.scripts]
my-cli = "my_package.cli:main"

[project.gui-scripts]
my-gui = "my_package.gui:start"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.scripts?.['my-cli']).toBe('my_package.cli:main')
      expect(result.project?.guiScripts?.['my-gui']).toBe('my_package.gui:start')
    })

    it('parses entry-points', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.entry-points."pytest11"]
my_plugin = "my_package.pytest_plugin"
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.entryPoints?.['pytest11']?.['my_plugin']).toBe('my_package.pytest_plugin')
    })
  })

  describe('[project.optional-dependencies] for extras', () => {
    it('parses optional dependency groups', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.optional-dependencies]
dev = ["pytest>=7.0", "black", "mypy"]
docs = ["sphinx>=5.0", "sphinx-rtd-theme"]
all = ["my-package[dev,docs]"]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.optionalDependencies?.dev).toHaveLength(3)
      expect(result.project?.optionalDependencies?.docs).toHaveLength(2)
      expect(result.project?.optionalDependencies?.all).toEqual(['my-package[dev,docs]'])
    })

    it('handles empty optional dependency groups', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.optional-dependencies]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.optionalDependencies).toBeDefined()
      expect(Object.keys(result.project?.optionalDependencies ?? {})).toHaveLength(0)
    })
  })

  describe('[build-system] section (PEP 517/518)', () => {
    it('parses requires list', () => {
      const toml = `
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"
`
      const result = parsePyprojectToml(toml)
      expect(result.buildSystem?.requires).toEqual(['setuptools>=61.0', 'wheel'])
    })

    it('parses build-backend', () => {
      const toml = `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
`
      const result = parsePyprojectToml(toml)
      expect(result.buildSystem?.buildBackend).toBe('hatchling.build')
    })

    it('parses backend-path', () => {
      const toml = `
[build-system]
requires = ["setuptools"]
build-backend = "custom_backend"
backend-path = ["backend"]
`
      const result = parsePyprojectToml(toml)
      expect(result.buildSystem?.backendPath).toEqual(['backend'])
    })

    it('handles various build backends', () => {
      const backends = [
        { backend: 'setuptools.build_meta', requires: ['setuptools>=61.0'] },
        { backend: 'hatchling.build', requires: ['hatchling'] },
        { backend: 'flit_core.buildapi', requires: ['flit_core>=3.4'] },
        { backend: 'poetry.core.masonry.api', requires: ['poetry-core>=1.0.0'] },
        { backend: 'maturin', requires: ['maturin>=1.0'] },
        { backend: 'pdm.backend', requires: ['pdm-backend'] },
      ]

      for (const { backend, requires } of backends) {
        const toml = `
[build-system]
requires = ${JSON.stringify(requires)}
build-backend = "${backend}"
`
        const result = parsePyprojectToml(toml)
        expect(result.buildSystem?.buildBackend).toBe(backend)
      }
    })
  })

  describe('[tool.*] sections', () => {
    it('parses tool.setuptools configuration', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[tool.setuptools]
packages = ["my_package"]
include-package-data = true
`
      const result = parsePyprojectToml(toml)
      const setuptools = result.tool?.setuptools as Record<string, unknown> | undefined
      expect(setuptools?.packages).toEqual(['my_package'])
    })

    it('parses tool.poetry configuration', () => {
      const toml = `
[tool.poetry]
name = "my-package"
version = "1.0.0"
description = "A poetry project"
authors = ["Author <author@example.com.ai>"]

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.0"
`
      const result = parsePyprojectToml(toml)
      const poetry = result.tool?.poetry as Record<string, unknown> | undefined
      const dependencies = poetry?.dependencies as Record<string, unknown> | undefined
      expect(poetry?.name).toBe('my-package')
      expect(dependencies?.python).toBe('^3.9')
    })

    it('parses tool.hatch configuration', () => {
      const toml = `
[tool.hatch.version]
path = "src/my_package/__about__.py"

[tool.hatch.build.targets.wheel]
packages = ["src/my_package"]
`
      const result = parsePyprojectToml(toml)
      const hatch = result.tool?.hatch as Record<string, unknown> | undefined
      const version = hatch?.version as Record<string, unknown> | undefined
      expect(version?.path).toBe('src/my_package/__about__.py')
    })
  })

  describe('dynamic fields', () => {
    it('parses dynamic field list', () => {
      const toml = `
[project]
name = "my-package"
dynamic = ["version", "description"]
`
      const result = parsePyprojectToml(toml)
      expect(result.project?.dynamic).toEqual(['version', 'description'])
    })
  })

  describe('error handling', () => {
    it('throws on invalid TOML syntax', () => {
      const invalidToml = `
[project
name = "broken"
`
      expect(() => parsePyprojectToml(invalidToml)).toThrow()
    })

    it('handles missing [project] section', () => {
      const toml = `
[build-system]
requires = ["setuptools"]
`
      const result = parsePyprojectToml(toml)
      expect(result.project).toBeUndefined()
    })
  })
})

// =============================================================================
// requirements.txt Parsing
// =============================================================================

describe('parseRequirementsTxt', () => {
  describe('simple version specifiers', () => {
    it('parses package==version', () => {
      const requirements = 'requests==2.28.0'
      const result = parseRequirementsTxt(requirements)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('requests')
      expect(result[0].specifiers).toEqual([{ op: '==', version: '2.28.0' }])
    })

    it('parses package>=version', () => {
      const requirements = 'numpy>=1.24.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '>=', version: '1.24.0' }])
    })

    it('parses package<=version', () => {
      const requirements = 'pandas<=2.0.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '<=', version: '2.0.0' }])
    })

    it('parses package>version', () => {
      const requirements = 'flask>2.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '>', version: '2.0' }])
    })

    it('parses package<version', () => {
      const requirements = 'django<4.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '<', version: '4.0' }])
    })

    it('parses package!=version', () => {
      const requirements = 'urllib3!=1.25.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '!=', version: '1.25.0' }])
    })

    it('parses package without version (any version)', () => {
      const requirements = 'click'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('click')
      expect(result[0].specifiers).toEqual([])
    })
  })

  describe('version ranges', () => {
    it('parses package>=min,<max', () => {
      const requirements = 'requests>=2.0,<3.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([
        { op: '>=', version: '2.0' },
        { op: '<', version: '3.0' },
      ])
    })

    it('parses package>=min,<=max', () => {
      const requirements = 'numpy>=1.20.0,<=1.26.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([
        { op: '>=', version: '1.20.0' },
        { op: '<=', version: '1.26.0' },
      ])
    })

    it('parses multiple exclusions', () => {
      const requirements = 'package!=1.0,!=1.1,!=1.2'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toHaveLength(3)
    })

    it('parses complex version constraints', () => {
      const requirements = 'package>=1.0,<2.0,!=1.5.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([
        { op: '>=', version: '1.0' },
        { op: '<', version: '2.0' },
        { op: '!=', version: '1.5.0' },
      ])
    })
  })

  describe('extras', () => {
    it('parses package[extra]', () => {
      const requirements = 'requests[security]'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('requests')
      expect(result[0].extras).toEqual(['security'])
    })

    it('parses package[extra1,extra2]', () => {
      const requirements = 'pandas[excel,sql]>=2.0.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('pandas')
      expect(result[0].extras).toEqual(['excel', 'sql'])
      expect(result[0].specifiers).toEqual([{ op: '>=', version: '2.0.0' }])
    })

    it('parses package with multiple extras and complex version', () => {
      const requirements = 'httpx[http2,socks]>=0.24.0,<1.0.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('httpx')
      expect(result[0].extras).toEqual(['http2', 'socks'])
      expect(result[0].specifiers).toHaveLength(2)
    })
  })

  describe('compatible release operator (~=)', () => {
    it('parses ~= operator', () => {
      const requirements = 'flask~=2.3.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '~=', version: '2.3.0' }])
    })

    it('parses ~= with two-part version', () => {
      const requirements = 'django~=4.2'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '~=', version: '4.2' }])
    })
  })

  describe('arbitrary equality (===)', () => {
    it('parses === operator', () => {
      const requirements = 'package===1.0.dev456'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toEqual([{ op: '===', version: '1.0.dev456' }])
    })
  })

  describe('comments and blank lines', () => {
    it('ignores comment lines', () => {
      const requirements = `
# This is a comment
requests==2.28.0
# Another comment
numpy>=1.24.0
`
      const result = parseRequirementsTxt(requirements)
      expect(result).toHaveLength(2)
    })

    it('ignores inline comments', () => {
      const requirements = 'requests==2.28.0  # for HTTP'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('requests')
      expect(result[0].specifiers).toEqual([{ op: '==', version: '2.28.0' }])
    })

    it('ignores blank lines', () => {
      const requirements = `
requests==2.28.0

numpy>=1.24.0

pandas==2.0.0
`
      const result = parseRequirementsTxt(requirements)
      expect(result).toHaveLength(3)
    })

    it('handles mixed comments and blank lines', () => {
      const requirements = `
# Python dependencies
requests>=2.28.0

# Data science
numpy~=1.24.0
pandas>=2.0.0  # dataframes

# End of file
`
      const result = parseRequirementsTxt(requirements)
      expect(result).toHaveLength(3)
    })
  })

  describe('-r includes', () => {
    it('parses -r flag', () => {
      const requirements = `
-r base.txt
requests>=2.28.0
`
      const result = parseRequirementsTxt(requirements)
      expect(result.some(r => r.type === 'include' && r.path === 'base.txt')).toBe(true)
    })

    it('parses --requirement flag', () => {
      const requirements = '--requirement common.txt'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].type).toBe('include')
      expect(result[0].path).toBe('common.txt')
    })

    it('parses multiple includes', () => {
      const requirements = `
-r base.txt
-r dev.txt
pytest>=7.0
`
      const result = parseRequirementsTxt(requirements)
      const includes = result.filter(r => r.type === 'include')
      expect(includes).toHaveLength(2)
    })
  })

  describe('-c constraints', () => {
    it('parses -c flag', () => {
      const requirements = '-c constraints.txt'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].type).toBe('constraint')
      expect(result[0].path).toBe('constraints.txt')
    })

    it('parses --constraint flag', () => {
      const requirements = '--constraint production.txt'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].type).toBe('constraint')
      expect(result[0].path).toBe('production.txt')
    })
  })

  describe('environment markers', () => {
    it('parses platform markers', () => {
      const requirements = 'pywin32>=300; sys_platform == "win32"'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('pywin32')
      expect(result[0].marker).toBe('sys_platform == "win32"')
    })

    it('parses Python version markers', () => {
      const requirements = 'typing-extensions>=4.0; python_version < "3.11"'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].marker).toBe('python_version < "3.11"')
    })

    it('parses complex markers with and/or', () => {
      const requirements = 'package>=1.0; python_version >= "3.8" and sys_platform != "win32"'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].marker).toBe('python_version >= "3.8" and sys_platform != "win32"')
    })

    it('parses extras with markers', () => {
      const requirements = 'package[extra]>=1.0; python_version >= "3.9"'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('package')
      expect(result[0].extras).toEqual(['extra'])
      expect(result[0].marker).toBeDefined()
    })
  })

  describe('URL-based requirements', () => {
    it('parses package @ URL', () => {
      const requirements = 'package @ https://example.com.ai/package.whl'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].name).toBe('package')
      expect(result[0].url).toBe('https://example.com.ai/package.whl')
    })

    it('parses git+https URL', () => {
      const requirements = 'package @ git+https://github.com/user/repo.git@v1.0.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].url).toBe('git+https://github.com/user/repo.git@v1.0.0')
    })

    it('parses URL with extras', () => {
      const requirements = 'package[extra] @ https://example.com.ai/package.whl'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].extras).toEqual(['extra'])
      expect(result[0].url).toBeDefined()
    })
  })

  describe('editable installs', () => {
    it('parses -e flag with path', () => {
      const requirements = '-e ./my-package'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].editable).toBe(true)
      expect(result[0].path).toBe('./my-package')
    })

    it('parses -e with git URL', () => {
      const requirements = '-e git+https://github.com/user/repo.git#egg=package'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].editable).toBe(true)
      expect(result[0].url).toBe('git+https://github.com/user/repo.git#egg=package')
    })

    it('parses --editable flag', () => {
      const requirements = '--editable ../local-package'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].editable).toBe(true)
    })
  })

  describe('options and flags', () => {
    it('parses --index-url', () => {
      const requirements = `
--index-url https://pypi.example.com.ai/simple/
requests>=2.28.0
`
      const result = parseRequirementsTxt(requirements)
      const option = result.find(r => r.type === 'option')
      expect(option?.option).toBe('--index-url')
      expect(option?.value).toBe('https://pypi.example.com.ai/simple/')
    })

    it('parses --extra-index-url', () => {
      const requirements = '--extra-index-url https://private.pypi.com/simple/'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].option).toBe('--extra-index-url')
    })

    it('parses --trusted-host', () => {
      const requirements = '--trusted-host pypi.example.com.ai'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].option).toBe('--trusted-host')
    })

    it('parses --no-binary', () => {
      const requirements = '--no-binary :all:'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].option).toBe('--no-binary')
      expect(result[0].value).toBe(':all:')
    })

    it('parses --only-binary', () => {
      const requirements = '--only-binary numpy,pandas'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].option).toBe('--only-binary')
    })
  })

  describe('line continuation', () => {
    it('handles backslash line continuation', () => {
      const requirements = `package>=1.0,\\
<2.0,\\
!=1.5.0`
      const result = parseRequirementsTxt(requirements)
      expect(result[0].specifiers).toHaveLength(3)
    })
  })

  describe('normalization', () => {
    it('normalizes package names (PEP 503)', () => {
      const requirements = 'My_Package>=1.0'
      const result = parseRequirementsTxt(requirements)
      expect(result[0].normalizedName).toBe('my-package')
    })

    it('handles underscores, dots, and hyphens equivalently', () => {
      const names = ['my_package', 'my.package', 'my-package', 'My_Package']
      for (const name of names) {
        const result = parseRequirementsTxt(name)
        expect(result[0].normalizedName).toBe('my-package')
      }
    })
  })
})

// =============================================================================
// Version Specifiers (PEP 440)
// =============================================================================

describe('parseVersionSpecifier', () => {
  describe('operators', () => {
    it('parses == (version matching)', () => {
      const result = parseVersionSpecifier('==1.0.0')
      expect(result.op).toBe('==')
      expect(result.version).toBe('1.0.0')
    })

    it('parses != (version exclusion)', () => {
      const result = parseVersionSpecifier('!=1.5.0')
      expect(result.op).toBe('!=')
      expect(result.version).toBe('1.5.0')
    })

    it('parses < (less than)', () => {
      const result = parseVersionSpecifier('<2.0')
      expect(result.op).toBe('<')
      expect(result.version).toBe('2.0')
    })

    it('parses <= (less than or equal)', () => {
      const result = parseVersionSpecifier('<=2.0.0')
      expect(result.op).toBe('<=')
      expect(result.version).toBe('2.0.0')
    })

    it('parses > (greater than)', () => {
      const result = parseVersionSpecifier('>1.0')
      expect(result.op).toBe('>')
      expect(result.version).toBe('1.0')
    })

    it('parses >= (greater than or equal)', () => {
      const result = parseVersionSpecifier('>=1.0.0')
      expect(result.op).toBe('>=')
      expect(result.version).toBe('1.0.0')
    })

    it('parses ~= (compatible release)', () => {
      const result = parseVersionSpecifier('~=1.4.2')
      expect(result.op).toBe('~=')
      expect(result.version).toBe('1.4.2')
    })

    it('parses === (arbitrary equality)', () => {
      const result = parseVersionSpecifier('===1.0+local')
      expect(result.op).toBe('===')
      expect(result.version).toBe('1.0+local')
    })
  })

  describe('wildcards', () => {
    it('parses ==1.* wildcard', () => {
      const result = parseVersionSpecifier('==1.*')
      expect(result.op).toBe('==')
      expect(result.version).toBe('1.*')
      expect(result.isWildcard).toBe(true)
    })

    it('parses ==1.2.* wildcard', () => {
      const result = parseVersionSpecifier('==1.2.*')
      expect(result.version).toBe('1.2.*')
      expect(result.isWildcard).toBe(true)
    })

    it('parses !=1.* exclusion wildcard', () => {
      const result = parseVersionSpecifier('!=1.*')
      expect(result.op).toBe('!=')
      expect(result.isWildcard).toBe(true)
    })
  })

  describe('pre-release versions', () => {
    it('parses alpha versions', () => {
      const result = parseVersionSpecifier('==1.0.0a1')
      expect(result.version).toBe('1.0.0a1')
    })

    it('parses beta versions', () => {
      const result = parseVersionSpecifier('>=1.0.0b2')
      expect(result.version).toBe('1.0.0b2')
    })

    it('parses release candidate versions', () => {
      const result = parseVersionSpecifier('==2.0.0rc1')
      expect(result.version).toBe('2.0.0rc1')
    })

    it('parses dev versions', () => {
      const result = parseVersionSpecifier('>=1.0.0.dev1')
      expect(result.version).toBe('1.0.0.dev1')
    })
  })

  describe('post-release versions', () => {
    it('parses post versions', () => {
      const result = parseVersionSpecifier('==1.0.0.post1')
      expect(result.version).toBe('1.0.0.post1')
    })

    it('parses post versions with hyphen', () => {
      const result = parseVersionSpecifier('==1.0.0-1')
      expect(result.version).toBe('1.0.0-1')
    })
  })

  describe('local versions', () => {
    it('parses local version identifiers', () => {
      const result = parseVersionSpecifier('==1.0.0+ubuntu1')
      expect(result.version).toBe('1.0.0+ubuntu1')
      expect(result.localVersion).toBe('ubuntu1')
    })

    it('parses complex local versions', () => {
      const result = parseVersionSpecifier('==1.0.0+ubuntu.1.deadbeef')
      expect(result.localVersion).toBe('ubuntu.1.deadbeef')
    })
  })

  describe('epoch versions', () => {
    it('parses epoch prefix', () => {
      const result = parseVersionSpecifier('>=1!2.0.0')
      expect(result.epoch).toBe(1)
      expect(result.version).toBe('1!2.0.0')
    })
  })

  describe('edge cases', () => {
    it('handles whitespace', () => {
      const result = parseVersionSpecifier('>= 1.0.0')
      expect(result.op).toBe('>=')
      expect(result.version).toBe('1.0.0')
    })

    it('throws on invalid operator', () => {
      expect(() => parseVersionSpecifier('=1.0.0')).toThrow()
    })

    it('throws on invalid version format', () => {
      expect(() => parseVersionSpecifier('>=not.a.version')).toThrow()
    })
  })
})

// =============================================================================
// Python Version Constraints (requires-python)
// =============================================================================

describe('parsePythonVersionConstraint', () => {
  describe('simple constraints', () => {
    it('parses >=3.9', () => {
      const result = parsePythonVersionConstraint('>=3.9')
      expect(result.specifiers).toEqual([{ op: '>=', version: '3.9' }])
    })

    it('parses >=3.8,<4.0', () => {
      const result = parsePythonVersionConstraint('>=3.8,<4.0')
      expect(result.specifiers).toEqual([
        { op: '>=', version: '3.8' },
        { op: '<', version: '4.0' },
      ])
    })

    it('parses ==3.10.*', () => {
      const result = parsePythonVersionConstraint('==3.10.*')
      expect(result.specifiers).toEqual([{ op: '==', version: '3.10.*' }])
    })
  })

  describe('version checking', () => {
    it('checks if version 3.9 satisfies >=3.8', () => {
      const constraint = parsePythonVersionConstraint('>=3.8')
      expect(constraint.satisfies('3.9')).toBe(true)
      expect(constraint.satisfies('3.7')).toBe(false)
    })

    it('checks if version satisfies range', () => {
      const constraint = parsePythonVersionConstraint('>=3.8,<3.12')
      expect(constraint.satisfies('3.9')).toBe(true)
      expect(constraint.satisfies('3.12')).toBe(false)
      expect(constraint.satisfies('3.7')).toBe(false)
    })

    it('checks if version satisfies exclusion', () => {
      const constraint = parsePythonVersionConstraint('>=3.8,!=3.9.0')
      expect(constraint.satisfies('3.8.0')).toBe(true)
      expect(constraint.satisfies('3.9.0')).toBe(false)
      expect(constraint.satisfies('3.9.1')).toBe(true)
    })

    it('checks wildcard constraints', () => {
      const constraint = parsePythonVersionConstraint('==3.10.*')
      expect(constraint.satisfies('3.10.0')).toBe(true)
      expect(constraint.satisfies('3.10.5')).toBe(true)
      expect(constraint.satisfies('3.11.0')).toBe(false)
    })
  })

  describe('compatible release (~=)', () => {
    it('parses ~=3.9 as >=3.9,==3.*', () => {
      const constraint = parsePythonVersionConstraint('~=3.9')
      expect(constraint.satisfies('3.9')).toBe(true)
      expect(constraint.satisfies('3.10')).toBe(true)
      expect(constraint.satisfies('4.0')).toBe(false)
    })

    it('parses ~=3.9.5 as >=3.9.5,==3.9.*', () => {
      const constraint = parsePythonVersionConstraint('~=3.9.5')
      expect(constraint.satisfies('3.9.5')).toBe(true)
      expect(constraint.satisfies('3.9.10')).toBe(true)
      expect(constraint.satisfies('3.10.0')).toBe(false)
    })
  })

  describe('minimum supported version', () => {
    it('returns minimum version for simple constraint', () => {
      const constraint = parsePythonVersionConstraint('>=3.9')
      expect(constraint.minVersion).toBe('3.9')
    })

    it('returns minimum version for range', () => {
      const constraint = parsePythonVersionConstraint('>=3.8,<4.0')
      expect(constraint.minVersion).toBe('3.8')
    })
  })
})

// =============================================================================
// Package Metadata Extraction
// =============================================================================

describe('extractPackageMetadata', () => {
  describe('from pyproject.toml', () => {
    it('extracts basic metadata', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"
description = "A sample package"
requires-python = ">=3.9"
dependencies = ["requests>=2.28.0"]
`
      const metadata = extractPackageMetadata(toml)
      expect(metadata.name).toBe('my-package')
      expect(metadata.version).toBe('1.0.0')
      expect(metadata.description).toBe('A sample package')
      expect(metadata.requiresPython).toBe('>=3.9')
      expect(metadata.dependencies).toHaveLength(1)
    })

    it('extracts optional dependencies', () => {
      const toml = `
[project]
name = "my-package"
version = "1.0.0"

[project.optional-dependencies]
dev = ["pytest>=7.0"]
docs = ["sphinx>=5.0"]
`
      const metadata = extractPackageMetadata(toml)
      expect(metadata.optionalDependencies).toHaveProperty('dev')
      expect(metadata.optionalDependencies).toHaveProperty('docs')
    })

    it('extracts entry points', () => {
      const toml = `
[project]
name = "my-cli"
version = "1.0.0"

[project.scripts]
my-cli = "my_package.cli:main"
`
      const metadata = extractPackageMetadata(toml)
      expect(metadata.entryPoints?.console_scripts).toContain('my-cli = my_package.cli:main')
    })
  })

  describe('from setup.py (legacy)', () => {
    it('extracts metadata from setup() call', () => {
      const setupPy = `
from setuptools import setup

setup(
    name='my-package',
    version='1.0.0',
    description='A sample package',
    install_requires=[
        'requests>=2.28.0',
        'numpy',
    ],
)
`
      const metadata = extractPackageMetadata(setupPy, 'setup.py')
      expect(metadata.name).toBe('my-package')
      expect(metadata.version).toBe('1.0.0')
      expect(metadata.dependencies).toHaveLength(2)
    })

    it('handles extras_require', () => {
      const setupPy = `
setup(
    name='my-package',
    version='1.0.0',
    extras_require={
        'dev': ['pytest', 'black'],
        'docs': ['sphinx'],
    },
)
`
      const metadata = extractPackageMetadata(setupPy, 'setup.py')
      expect(metadata.optionalDependencies?.dev).toHaveLength(2)
    })
  })

  describe('from setup.cfg (legacy)', () => {
    it('extracts metadata section', () => {
      const setupCfg = `
[metadata]
name = my-package
version = 1.0.0
description = A sample package

[options]
install_requires =
    requests>=2.28.0
    numpy
python_requires = >=3.8
`
      const metadata = extractPackageMetadata(setupCfg, 'setup.cfg')
      expect(metadata.name).toBe('my-package')
      expect(metadata.version).toBe('1.0.0')
      expect(metadata.requiresPython).toBe('>=3.8')
    })
  })

  describe('metadata normalization', () => {
    it('normalizes package name', () => {
      const metadata = extractPackageMetadata(`
[project]
name = "My_Package"
version = "1.0.0"
`)
      expect(metadata.normalizedName).toBe('my-package')
    })

    it('parses all dependencies into structured format', () => {
      const metadata = extractPackageMetadata(`
[project]
name = "my-package"
version = "1.0.0"
dependencies = ["requests>=2.28.0,<3.0.0"]
`)
      expect(metadata.parsedDependencies?.[0].name).toBe('requests')
      expect(metadata.parsedDependencies?.[0].specifiers).toHaveLength(2)
    })
  })

  describe('source detection', () => {
    it('detects pyproject.toml format', () => {
      const metadata = extractPackageMetadata('[project]\nname = "pkg"', 'pyproject.toml')
      expect(metadata.source).toBe('pyproject.toml')
    })

    it('auto-detects format from content', () => {
      const tomlContent = '[project]\nname = "pkg"\nversion = "1.0.0"'
      const metadata = extractPackageMetadata(tomlContent)
      expect(metadata.source).toBe('pyproject.toml')
    })
  })
})
