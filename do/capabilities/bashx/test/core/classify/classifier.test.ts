/**
 * Command Classifier Tests (RED Phase)
 *
 * Tests for classifying bash commands by their operational category.
 * This enables intelligent routing, permission systems, and workflow orchestration.
 *
 * Categories:
 * - file: File system operations (read, write, delete, copy, move)
 * - process: Process management (kill, monitor)
 * - network: Network operations (fetch, listen, connect)
 * - system: System administration (mount, service management)
 * - package: Package management (install, uninstall, update)
 * - development: Development tools (build, test, lint)
 * - git: Version control operations
 * - container: Container orchestration (docker, podman, kubectl)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The classifier implementation will be done in the GREEN phase.
 */

import { describe, it, expect } from 'vitest'

// Import the classifier we're going to implement
// This import will fail until the function is created
import {
  classifyCommand,
  type CommandCategory,
  type CommandClassificationResult,
} from '../../../src/classify.js'

describe('Command Classifier', () => {
  // ==========================================================================
  // File Operations
  // ==========================================================================
  describe('File Operations', () => {
    describe('read operations', () => {
      it('should classify "cat file.txt" as file/read', async () => {
        const result = await classifyCommand('cat file.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })

      it('should classify "cat -n package.json" as file/read', async () => {
        const result = await classifyCommand('cat -n package.json')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })

      it('should classify "head -10 log.txt" as file/read', async () => {
        const result = await classifyCommand('head -10 log.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })

      it('should classify "tail -f /var/log/syslog" as file/read', async () => {
        const result = await classifyCommand('tail -f /var/log/syslog')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })

      it('should classify "less README.md" as file/read', async () => {
        const result = await classifyCommand('less README.md')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })

      it('should classify "more file.txt" as file/read', async () => {
        const result = await classifyCommand('more file.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('read')
      })
    })

    describe('write operations', () => {
      it('should classify "echo hello > file.txt" as file/write', async () => {
        const result = await classifyCommand('echo hello > file.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('write')
      })

      it('should classify "echo data >> log.txt" as file/write', async () => {
        const result = await classifyCommand('echo data >> log.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('write')
      })

      it('should classify "touch newfile.txt" as file/write', async () => {
        const result = await classifyCommand('touch newfile.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('write')
      })

      it('should classify "mkdir -p src/components" as file/write', async () => {
        const result = await classifyCommand('mkdir -p src/components')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('write')
      })

      it('should classify "tee output.txt" as file/write', async () => {
        const result = await classifyCommand('tee output.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('write')
      })
    })

    describe('delete operations', () => {
      it('should classify "rm file.txt" as file/delete', async () => {
        const result = await classifyCommand('rm file.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('delete')
      })

      it('should classify "rm -rf node_modules" as file/delete', async () => {
        const result = await classifyCommand('rm -rf node_modules')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('delete')
      })

      it('should classify "rm -i *.log" as file/delete', async () => {
        const result = await classifyCommand('rm -i *.log')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('delete')
      })

      it('should classify "rmdir empty_dir" as file/delete', async () => {
        const result = await classifyCommand('rmdir empty_dir')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('delete')
      })

      it('should classify "unlink symlink" as file/delete', async () => {
        const result = await classifyCommand('unlink symlink')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('delete')
      })
    })

    describe('copy operations', () => {
      it('should classify "cp file.txt backup.txt" as file/copy', async () => {
        const result = await classifyCommand('cp file.txt backup.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('copy')
      })

      it('should classify "cp -r src/ dest/" as file/copy', async () => {
        const result = await classifyCommand('cp -r src/ dest/')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('copy')
      })

      it('should classify "cp -a /home/user /backup" as file/copy', async () => {
        const result = await classifyCommand('cp -a /home/user /backup')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('copy')
      })
    })

    describe('move operations', () => {
      it('should classify "mv old.txt new.txt" as file/move', async () => {
        const result = await classifyCommand('mv old.txt new.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('move')
      })

      it('should classify "mv file.txt /tmp/" as file/move', async () => {
        const result = await classifyCommand('mv file.txt /tmp/')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('move')
      })

      it('should classify "mv -i *.js src/" as file/move', async () => {
        const result = await classifyCommand('mv -i *.js src/')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('move')
      })
    })

    describe('list/search operations', () => {
      it('should classify "ls -la" as file/list', async () => {
        const result = await classifyCommand('ls -la')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('list')
      })

      it('should classify "find . -name *.ts" as file/search', async () => {
        const result = await classifyCommand('find . -name *.ts')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('search')
      })

      it('should classify "locate config" as file/search', async () => {
        const result = await classifyCommand('locate config')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('search')
      })
    })

    describe('permission operations', () => {
      it('should classify "chmod 755 script.sh" as file/permission', async () => {
        const result = await classifyCommand('chmod 755 script.sh')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('permission')
      })

      it('should classify "chown user:group file.txt" as file/permission', async () => {
        const result = await classifyCommand('chown user:group file.txt')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('permission')
      })

      it('should classify "chgrp developers project/" as file/permission', async () => {
        const result = await classifyCommand('chgrp developers project/')
        expect(result.category).toBe('file')
        expect(result.operation).toBe('permission')
      })
    })
  })

  // ==========================================================================
  // Process Operations
  // ==========================================================================
  describe('Process Operations', () => {
    describe('kill operations', () => {
      it('should classify "kill 1234" as process/kill', async () => {
        const result = await classifyCommand('kill 1234')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })

      it('should classify "kill -9 5678" as process/kill', async () => {
        const result = await classifyCommand('kill -9 5678')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })

      it('should classify "kill -SIGTERM 1234" as process/kill', async () => {
        const result = await classifyCommand('kill -SIGTERM 1234')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })

      it('should classify "pkill node" as process/kill', async () => {
        const result = await classifyCommand('pkill node')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })

      it('should classify "pkill -f "npm run dev"" as process/kill', async () => {
        const result = await classifyCommand('pkill -f "npm run dev"')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })

      it('should classify "killall nginx" as process/kill', async () => {
        const result = await classifyCommand('killall nginx')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('kill')
      })
    })

    describe('monitor operations', () => {
      it('should classify "ps aux" as process/monitor', async () => {
        const result = await classifyCommand('ps aux')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })

      it('should classify "ps -ef | grep node" as process/monitor', async () => {
        const result = await classifyCommand('ps -ef | grep node')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })

      it('should classify "top" as process/monitor', async () => {
        const result = await classifyCommand('top')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })

      it('should classify "top -b -n 1" as process/monitor', async () => {
        const result = await classifyCommand('top -b -n 1')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })

      it('should classify "htop" as process/monitor', async () => {
        const result = await classifyCommand('htop')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })

      it('should classify "pgrep -l python" as process/monitor', async () => {
        const result = await classifyCommand('pgrep -l python')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('monitor')
      })
    })

    describe('control operations', () => {
      it('should classify "nohup ./server &" as process/control', async () => {
        const result = await classifyCommand('nohup ./server &')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('control')
      })

      it('should classify "nice -n 10 ./task" as process/control', async () => {
        const result = await classifyCommand('nice -n 10 ./task')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('control')
      })

      it('should classify "renice -n 5 -p 1234" as process/control', async () => {
        const result = await classifyCommand('renice -n 5 -p 1234')
        expect(result.category).toBe('process')
        expect(result.operation).toBe('control')
      })
    })
  })

  // ==========================================================================
  // Network Operations
  // ==========================================================================
  describe('Network Operations', () => {
    describe('fetch operations', () => {
      it('should classify "curl https://api.example.com.ai" as network/fetch', async () => {
        const result = await classifyCommand('curl https://api.example.com.ai')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('fetch')
      })

      it('should classify "curl -X POST -d data api.com" as network/fetch', async () => {
        const result = await classifyCommand('curl -X POST -d data api.com')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('fetch')
      })

      it('should classify "curl -o file.zip url" as network/fetch', async () => {
        const result = await classifyCommand('curl -o file.zip https://example.com.ai/file.zip')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('fetch')
      })

      it('should classify "wget https://example.com.ai/file" as network/fetch', async () => {
        const result = await classifyCommand('wget https://example.com.ai/file')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('fetch')
      })

      it('should classify "wget -r website.com" as network/fetch', async () => {
        const result = await classifyCommand('wget -r website.com')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('fetch')
      })
    })

    describe('listen operations', () => {
      it('should classify "nc -l 8080" as network/listen', async () => {
        const result = await classifyCommand('nc -l 8080')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('listen')
      })

      it('should classify "nc -l -p 3000" as network/listen', async () => {
        const result = await classifyCommand('nc -l -p 3000')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('listen')
      })

      it('should classify "netcat -l 9000" as network/listen', async () => {
        const result = await classifyCommand('netcat -l 9000')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('listen')
      })

      it('should classify "socat TCP-LISTEN:8080,fork -" as network/listen', async () => {
        const result = await classifyCommand('socat TCP-LISTEN:8080,fork -')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('listen')
      })
    })

    describe('connect operations', () => {
      it('should classify "ssh user@host" as network/connect', async () => {
        const result = await classifyCommand('ssh user@host')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })

      it('should classify "ssh -i key.pem ec2-user@aws" as network/connect', async () => {
        const result = await classifyCommand('ssh -i key.pem ec2-user@aws')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })

      it('should classify "scp file.txt user@host:/path" as network/connect', async () => {
        const result = await classifyCommand('scp file.txt user@host:/path')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })

      it('should classify "rsync -avz src/ user@host:dest/" as network/connect', async () => {
        const result = await classifyCommand('rsync -avz src/ user@host:dest/')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })

      it('should classify "nc host 80" as network/connect', async () => {
        const result = await classifyCommand('nc host 80')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })

      it('should classify "telnet host 23" as network/connect', async () => {
        const result = await classifyCommand('telnet host 23')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('connect')
      })
    })

    describe('diagnostic operations', () => {
      it('should classify "ping google.com" as network/diagnostic', async () => {
        const result = await classifyCommand('ping google.com')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "ping -c 4 8.8.8.8" as network/diagnostic', async () => {
        const result = await classifyCommand('ping -c 4 8.8.8.8')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "traceroute google.com" as network/diagnostic', async () => {
        const result = await classifyCommand('traceroute google.com')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "netstat -an" as network/diagnostic', async () => {
        const result = await classifyCommand('netstat -an')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "ss -tulpn" as network/diagnostic', async () => {
        const result = await classifyCommand('ss -tulpn')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "nslookup example.com.ai" as network/diagnostic', async () => {
        const result = await classifyCommand('nslookup example.com.ai')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })

      it('should classify "dig example.com.ai" as network/diagnostic', async () => {
        const result = await classifyCommand('dig example.com.ai')
        expect(result.category).toBe('network')
        expect(result.operation).toBe('diagnostic')
      })
    })
  })

  // ==========================================================================
  // System Operations
  // ==========================================================================
  describe('System Operations', () => {
    describe('mount operations', () => {
      it('should classify "mount /dev/sda1 /mnt" as system/mount', async () => {
        const result = await classifyCommand('mount /dev/sda1 /mnt')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('mount')
      })

      it('should classify "mount -t nfs server:/share /mnt" as system/mount', async () => {
        const result = await classifyCommand('mount -t nfs server:/share /mnt')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('mount')
      })

      it('should classify "umount /mnt" as system/mount', async () => {
        const result = await classifyCommand('umount /mnt')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('mount')
      })
    })

    describe('service operations (systemctl)', () => {
      it('should classify "systemctl start nginx" as system/service', async () => {
        const result = await classifyCommand('systemctl start nginx')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "systemctl stop postgresql" as system/service', async () => {
        const result = await classifyCommand('systemctl stop postgresql')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "systemctl restart docker" as system/service', async () => {
        const result = await classifyCommand('systemctl restart docker')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "systemctl enable ssh" as system/service', async () => {
        const result = await classifyCommand('systemctl enable ssh')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "systemctl status nginx" as system/service', async () => {
        const result = await classifyCommand('systemctl status nginx')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })
    })

    describe('service operations (legacy)', () => {
      it('should classify "service nginx start" as system/service', async () => {
        const result = await classifyCommand('service nginx start')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "service apache2 restart" as system/service', async () => {
        const result = await classifyCommand('service apache2 restart')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })

      it('should classify "/etc/init.d/mysql start" as system/service', async () => {
        const result = await classifyCommand('/etc/init.d/mysql start')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('service')
      })
    })

    describe('user management operations', () => {
      it('should classify "useradd newuser" as system/user', async () => {
        const result = await classifyCommand('useradd newuser')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('user')
      })

      it('should classify "userdel olduser" as system/user', async () => {
        const result = await classifyCommand('userdel olduser')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('user')
      })

      it('should classify "usermod -aG docker user" as system/user', async () => {
        const result = await classifyCommand('usermod -aG docker user')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('user')
      })

      it('should classify "passwd user" as system/user', async () => {
        const result = await classifyCommand('passwd user')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('user')
      })
    })

    describe('system info operations', () => {
      it('should classify "uname -a" as system/info', async () => {
        const result = await classifyCommand('uname -a')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })

      it('should classify "df -h" as system/info', async () => {
        const result = await classifyCommand('df -h')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })

      it('should classify "free -m" as system/info', async () => {
        const result = await classifyCommand('free -m')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })

      it('should classify "uptime" as system/info', async () => {
        const result = await classifyCommand('uptime')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })

      it('should classify "lsblk" as system/info', async () => {
        const result = await classifyCommand('lsblk')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })

      it('should classify "dmesg" as system/info', async () => {
        const result = await classifyCommand('dmesg')
        expect(result.category).toBe('system')
        expect(result.operation).toBe('info')
      })
    })
  })

  // ==========================================================================
  // Package Operations
  // ==========================================================================
  describe('Package Operations', () => {
    describe('apt package manager', () => {
      it('should classify "apt install nginx" as package/install', async () => {
        const result = await classifyCommand('apt install nginx')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "apt-get install -y nodejs" as package/install', async () => {
        const result = await classifyCommand('apt-get install -y nodejs')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "apt remove nginx" as package/uninstall', async () => {
        const result = await classifyCommand('apt remove nginx')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('uninstall')
      })

      it('should classify "apt update" as package/update', async () => {
        const result = await classifyCommand('apt update')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('update')
      })

      it('should classify "apt upgrade" as package/upgrade', async () => {
        const result = await classifyCommand('apt upgrade')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('upgrade')
      })

      it('should classify "apt search vim" as package/search', async () => {
        const result = await classifyCommand('apt search vim')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('search')
      })
    })

    describe('npm package manager', () => {
      it('should classify "npm install express" as package/install', async () => {
        const result = await classifyCommand('npm install express')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "npm i -D typescript" as package/install', async () => {
        const result = await classifyCommand('npm i -D typescript')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "npm install" as package/install', async () => {
        const result = await classifyCommand('npm install')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "npm uninstall lodash" as package/uninstall', async () => {
        const result = await classifyCommand('npm uninstall lodash')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('uninstall')
      })

      it('should classify "npm update" as package/update', async () => {
        const result = await classifyCommand('npm update')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('update')
      })
    })

    describe('pip package manager', () => {
      it('should classify "pip install requests" as package/install', async () => {
        const result = await classifyCommand('pip install requests')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "pip3 install -r requirements.txt" as package/install', async () => {
        const result = await classifyCommand('pip3 install -r requirements.txt')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "pip uninstall numpy" as package/uninstall', async () => {
        const result = await classifyCommand('pip uninstall numpy')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('uninstall')
      })

      it('should classify "pip install --upgrade pip" as package/upgrade', async () => {
        const result = await classifyCommand('pip install --upgrade pip')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('upgrade')
      })
    })

    describe('other package managers', () => {
      it('should classify "yarn add react" as package/install', async () => {
        const result = await classifyCommand('yarn add react')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "pnpm install" as package/install', async () => {
        const result = await classifyCommand('pnpm install')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "brew install node" as package/install', async () => {
        const result = await classifyCommand('brew install node')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "yum install httpd" as package/install', async () => {
        const result = await classifyCommand('yum install httpd')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "dnf install git" as package/install', async () => {
        const result = await classifyCommand('dnf install git')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "cargo install ripgrep" as package/install', async () => {
        const result = await classifyCommand('cargo install ripgrep')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })

      it('should classify "go install golang.org/x/tools/gopls@latest" as package/install', async () => {
        const result = await classifyCommand('go install golang.org/x/tools/gopls@latest')
        expect(result.category).toBe('package')
        expect(result.operation).toBe('install')
      })
    })
  })

  // ==========================================================================
  // Development Operations
  // ==========================================================================
  describe('Development Operations', () => {
    describe('build operations', () => {
      it('should classify "npm run build" as development/build', async () => {
        const result = await classifyCommand('npm run build')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "yarn build" as development/build', async () => {
        const result = await classifyCommand('yarn build')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "make build" as development/build', async () => {
        const result = await classifyCommand('make build')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "make" as development/build', async () => {
        const result = await classifyCommand('make')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "cargo build --release" as development/build', async () => {
        const result = await classifyCommand('cargo build --release')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "go build ./..." as development/build', async () => {
        const result = await classifyCommand('go build ./...')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "gcc -o main main.c" as development/build', async () => {
        const result = await classifyCommand('gcc -o main main.c')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })

      it('should classify "tsc" as development/build', async () => {
        const result = await classifyCommand('tsc')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('build')
      })
    })

    describe('test operations', () => {
      it('should classify "pytest" as development/test', async () => {
        const result = await classifyCommand('pytest')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "pytest tests/" as development/test', async () => {
        const result = await classifyCommand('pytest tests/')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "npm test" as development/test', async () => {
        const result = await classifyCommand('npm test')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "npm run test" as development/test', async () => {
        const result = await classifyCommand('npm run test')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "jest" as development/test', async () => {
        const result = await classifyCommand('jest')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "vitest run" as development/test', async () => {
        const result = await classifyCommand('vitest run')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "cargo test" as development/test', async () => {
        const result = await classifyCommand('cargo test')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "go test ./..." as development/test', async () => {
        const result = await classifyCommand('go test ./...')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })

      it('should classify "mocha" as development/test', async () => {
        const result = await classifyCommand('mocha')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('test')
      })
    })

    describe('lint operations', () => {
      it('should classify "eslint src/" as development/lint', async () => {
        const result = await classifyCommand('eslint src/')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "eslint . --fix" as development/lint', async () => {
        const result = await classifyCommand('eslint . --fix')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "npm run lint" as development/lint', async () => {
        const result = await classifyCommand('npm run lint')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "prettier --check ." as development/lint', async () => {
        const result = await classifyCommand('prettier --check .')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "pylint src/" as development/lint', async () => {
        const result = await classifyCommand('pylint src/')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "flake8" as development/lint', async () => {
        const result = await classifyCommand('flake8')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "rubocop" as development/lint', async () => {
        const result = await classifyCommand('rubocop')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })

      it('should classify "cargo clippy" as development/lint', async () => {
        const result = await classifyCommand('cargo clippy')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('lint')
      })
    })

    describe('format operations', () => {
      it('should classify "prettier --write ." as development/format', async () => {
        const result = await classifyCommand('prettier --write .')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('format')
      })

      it('should classify "black ." as development/format', async () => {
        const result = await classifyCommand('black .')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('format')
      })

      it('should classify "cargo fmt" as development/format', async () => {
        const result = await classifyCommand('cargo fmt')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('format')
      })

      it('should classify "gofmt -w ." as development/format', async () => {
        const result = await classifyCommand('gofmt -w .')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('format')
      })
    })

    describe('run/start operations', () => {
      it('should classify "npm start" as development/run', async () => {
        const result = await classifyCommand('npm start')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })

      it('should classify "npm run dev" as development/run', async () => {
        const result = await classifyCommand('npm run dev')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })

      it('should classify "python app.py" as development/run', async () => {
        const result = await classifyCommand('python app.py')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })

      it('should classify "node server.js" as development/run', async () => {
        const result = await classifyCommand('node server.js')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })

      it('should classify "cargo run" as development/run', async () => {
        const result = await classifyCommand('cargo run')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })

      it('should classify "go run main.go" as development/run', async () => {
        const result = await classifyCommand('go run main.go')
        expect(result.category).toBe('development')
        expect(result.operation).toBe('run')
      })
    })
  })

  // ==========================================================================
  // Git Operations
  // ==========================================================================
  describe('Git Operations', () => {
    describe('commit operations', () => {
      it('should classify "git commit -m message" as git/commit', async () => {
        const result = await classifyCommand('git commit -m "message"')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('commit')
      })

      it('should classify "git commit -am message" as git/commit', async () => {
        const result = await classifyCommand('git commit -am "message"')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('commit')
      })

      it('should classify "git commit --amend" as git/commit', async () => {
        const result = await classifyCommand('git commit --amend')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('commit')
      })
    })

    describe('push operations', () => {
      it('should classify "git push" as git/push', async () => {
        const result = await classifyCommand('git push')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('push')
      })

      it('should classify "git push origin main" as git/push', async () => {
        const result = await classifyCommand('git push origin main')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('push')
      })

      it('should classify "git push -u origin feature" as git/push', async () => {
        const result = await classifyCommand('git push -u origin feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('push')
      })

      it('should classify "git push --force" as git/push', async () => {
        const result = await classifyCommand('git push --force')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('push')
      })
    })

    describe('pull operations', () => {
      it('should classify "git pull" as git/pull', async () => {
        const result = await classifyCommand('git pull')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('pull')
      })

      it('should classify "git pull origin main" as git/pull', async () => {
        const result = await classifyCommand('git pull origin main')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('pull')
      })

      it('should classify "git pull --rebase" as git/pull', async () => {
        const result = await classifyCommand('git pull --rebase')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('pull')
      })

      it('should classify "git fetch origin" as git/pull', async () => {
        const result = await classifyCommand('git fetch origin')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('pull')
      })
    })

    describe('branch operations', () => {
      it('should classify "git branch feature" as git/branch', async () => {
        const result = await classifyCommand('git branch feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('branch')
      })

      it('should classify "git branch -d old-branch" as git/branch', async () => {
        const result = await classifyCommand('git branch -d old-branch')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('branch')
      })

      it('should classify "git checkout -b new-feature" as git/branch', async () => {
        const result = await classifyCommand('git checkout -b new-feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('branch')
      })

      it('should classify "git switch -c new-feature" as git/branch', async () => {
        const result = await classifyCommand('git switch -c new-feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('branch')
      })
    })

    describe('merge operations', () => {
      it('should classify "git merge feature" as git/merge', async () => {
        const result = await classifyCommand('git merge feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('merge')
      })

      it('should classify "git merge --no-ff feature" as git/merge', async () => {
        const result = await classifyCommand('git merge --no-ff feature')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('merge')
      })

      it('should classify "git rebase main" as git/merge', async () => {
        const result = await classifyCommand('git rebase main')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('merge')
      })

      it('should classify "git cherry-pick abc123" as git/merge', async () => {
        const result = await classifyCommand('git cherry-pick abc123')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('merge')
      })
    })

    describe('stage operations', () => {
      it('should classify "git add ." as git/stage', async () => {
        const result = await classifyCommand('git add .')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('stage')
      })

      it('should classify "git add -A" as git/stage', async () => {
        const result = await classifyCommand('git add -A')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('stage')
      })

      it('should classify "git reset HEAD file.txt" as git/stage', async () => {
        const result = await classifyCommand('git reset HEAD file.txt')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('stage')
      })

      it('should classify "git stash" as git/stage', async () => {
        const result = await classifyCommand('git stash')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('stage')
      })
    })

    describe('status operations', () => {
      it('should classify "git status" as git/status', async () => {
        const result = await classifyCommand('git status')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('status')
      })

      it('should classify "git log" as git/status', async () => {
        const result = await classifyCommand('git log')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('status')
      })

      it('should classify "git log --oneline -10" as git/status', async () => {
        const result = await classifyCommand('git log --oneline -10')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('status')
      })

      it('should classify "git diff" as git/status', async () => {
        const result = await classifyCommand('git diff')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('status')
      })

      it('should classify "git show HEAD" as git/status', async () => {
        const result = await classifyCommand('git show HEAD')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('status')
      })
    })

    describe('clone operations', () => {
      it('should classify "git clone url" as git/clone', async () => {
        const result = await classifyCommand('git clone https://github.com/repo.git')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('clone')
      })

      it('should classify "git clone --depth 1 url" as git/clone', async () => {
        const result = await classifyCommand('git clone --depth 1 https://github.com/repo.git')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('clone')
      })

      it('should classify "git init" as git/clone', async () => {
        const result = await classifyCommand('git init')
        expect(result.category).toBe('git')
        expect(result.operation).toBe('clone')
      })
    })
  })

  // ==========================================================================
  // Container Operations
  // ==========================================================================
  describe('Container Operations', () => {
    describe('docker run operations', () => {
      it('should classify "docker run nginx" as container/run', async () => {
        const result = await classifyCommand('docker run nginx')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })

      it('should classify "docker run -it ubuntu bash" as container/run', async () => {
        const result = await classifyCommand('docker run -it ubuntu bash')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })

      it('should classify "docker run -d -p 80:80 nginx" as container/run', async () => {
        const result = await classifyCommand('docker run -d -p 80:80 nginx')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })

      it('should classify "docker run --rm alpine echo hello" as container/run', async () => {
        const result = await classifyCommand('docker run --rm alpine echo hello')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })

      it('should classify "docker exec -it container bash" as container/run', async () => {
        const result = await classifyCommand('docker exec -it container bash')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })
    })

    describe('docker build operations', () => {
      it('should classify "docker build ." as container/build', async () => {
        const result = await classifyCommand('docker build .')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('build')
      })

      it('should classify "docker build -t myapp ." as container/build', async () => {
        const result = await classifyCommand('docker build -t myapp .')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('build')
      })

      it('should classify "docker build -f Dockerfile.prod ." as container/build', async () => {
        const result = await classifyCommand('docker build -f Dockerfile.prod .')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('build')
      })
    })

    describe('docker compose operations', () => {
      it('should classify "docker-compose up" as container/compose', async () => {
        const result = await classifyCommand('docker-compose up')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('compose')
      })

      it('should classify "docker-compose up -d" as container/compose', async () => {
        const result = await classifyCommand('docker-compose up -d')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('compose')
      })

      it('should classify "docker-compose down" as container/compose', async () => {
        const result = await classifyCommand('docker-compose down')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('compose')
      })

      it('should classify "docker compose up" as container/compose', async () => {
        const result = await classifyCommand('docker compose up')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('compose')
      })
    })

    describe('docker image operations', () => {
      it('should classify "docker pull nginx" as container/image', async () => {
        const result = await classifyCommand('docker pull nginx')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('image')
      })

      it('should classify "docker push myapp" as container/image', async () => {
        const result = await classifyCommand('docker push myapp')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('image')
      })

      it('should classify "docker images" as container/image', async () => {
        const result = await classifyCommand('docker images')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('image')
      })

      it('should classify "docker rmi old-image" as container/image', async () => {
        const result = await classifyCommand('docker rmi old-image')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('image')
      })
    })

    describe('docker status operations', () => {
      it('should classify "docker ps" as container/status', async () => {
        const result = await classifyCommand('docker ps')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('status')
      })

      it('should classify "docker ps -a" as container/status', async () => {
        const result = await classifyCommand('docker ps -a')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('status')
      })

      it('should classify "docker logs container" as container/status', async () => {
        const result = await classifyCommand('docker logs container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('status')
      })

      it('should classify "docker inspect container" as container/status', async () => {
        const result = await classifyCommand('docker inspect container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('status')
      })
    })

    describe('docker control operations', () => {
      it('should classify "docker stop container" as container/control', async () => {
        const result = await classifyCommand('docker stop container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('control')
      })

      it('should classify "docker start container" as container/control', async () => {
        const result = await classifyCommand('docker start container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('control')
      })

      it('should classify "docker restart container" as container/control', async () => {
        const result = await classifyCommand('docker restart container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('control')
      })

      it('should classify "docker kill container" as container/control', async () => {
        const result = await classifyCommand('docker kill container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('control')
      })

      it('should classify "docker rm container" as container/control', async () => {
        const result = await classifyCommand('docker rm container')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('control')
      })
    })

    describe('podman operations', () => {
      it('should classify "podman run nginx" as container/run', async () => {
        const result = await classifyCommand('podman run nginx')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('run')
      })

      it('should classify "podman build -t myapp ." as container/build', async () => {
        const result = await classifyCommand('podman build -t myapp .')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('build')
      })

      it('should classify "podman ps" as container/status', async () => {
        const result = await classifyCommand('podman ps')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('status')
      })
    })

    describe('kubernetes operations', () => {
      it('should classify "kubectl apply -f deployment.yaml" as container/orchestrate', async () => {
        const result = await classifyCommand('kubectl apply -f deployment.yaml')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('orchestrate')
      })

      it('should classify "kubectl get pods" as container/orchestrate', async () => {
        const result = await classifyCommand('kubectl get pods')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('orchestrate')
      })

      it('should classify "kubectl delete pod mypod" as container/orchestrate', async () => {
        const result = await classifyCommand('kubectl delete pod mypod')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('orchestrate')
      })

      it('should classify "kubectl logs pod" as container/orchestrate', async () => {
        const result = await classifyCommand('kubectl logs pod')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('orchestrate')
      })

      it('should classify "helm install mychart ./chart" as container/orchestrate', async () => {
        const result = await classifyCommand('helm install mychart ./chart')
        expect(result.category).toBe('container')
        expect(result.operation).toBe('orchestrate')
      })
    })
  })

  // ==========================================================================
  // Result Structure Tests
  // ==========================================================================
  describe('Classification Result Structure', () => {
    it('should include all required fields in result', async () => {
      const result = await classifyCommand('ls -la')

      expect(result).toHaveProperty('category')
      expect(result).toHaveProperty('operation')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('confidence')
    })

    it('should return confidence between 0 and 1', async () => {
      const commands = [
        'cat file.txt',
        'docker run nginx',
        'git push',
        'npm install',
      ]

      for (const cmd of commands) {
        const result = await classifyCommand(cmd)
        expect(result.confidence).toBeGreaterThanOrEqual(0)
        expect(result.confidence).toBeLessThanOrEqual(1)
      }
    })

    it('should include parsed command components', async () => {
      const result = await classifyCommand('git commit -m "message"')

      expect(result).toHaveProperty('parsed')
      expect(result.parsed).toHaveProperty('binary')
      expect(result.parsed).toHaveProperty('subcommand')
      expect(result.parsed).toHaveProperty('args')
      expect(result.parsed).toHaveProperty('flags')
    })

    it('should include risk assessment', async () => {
      const result = await classifyCommand('rm -rf /')

      expect(result).toHaveProperty('risk')
      expect(result.risk).toHaveProperty('level')
      expect(result.risk).toHaveProperty('reason')
    })
  })

  // ==========================================================================
  // Pipeline and Complex Command Tests
  // ==========================================================================
  describe('Pipeline and Complex Commands', () => {
    it('should classify pipeline by primary operation', async () => {
      const result = await classifyCommand('cat file.txt | grep pattern')
      expect(result.category).toBe('file')
      expect(result.operation).toBe('read')
    })

    it('should classify command with redirect as file operation', async () => {
      const result = await classifyCommand('ps aux > processes.txt')
      expect(result.category).toBe('file')
      expect(result.operation).toBe('write')
    })

    it('should handle compound commands with &&', async () => {
      const result = await classifyCommand('npm install && npm run build')
      expect(result).toHaveProperty('compound')
      expect(result.compound).toBe(true)
    })

    it('should identify all operations in compound command', async () => {
      const result = await classifyCommand('git add . && git commit -m "msg"')
      expect(result).toHaveProperty('operations')
      expect(result.operations).toContainEqual(
        expect.objectContaining({ category: 'git', operation: 'stage' })
      )
      expect(result.operations).toContainEqual(
        expect.objectContaining({ category: 'git', operation: 'commit' })
      )
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty command', async () => {
      const result = await classifyCommand('')
      expect(result.category).toBe('unknown')
    })

    it('should handle whitespace-only command', async () => {
      const result = await classifyCommand('   ')
      expect(result.category).toBe('unknown')
    })

    it('should handle unknown commands gracefully', async () => {
      const result = await classifyCommand('some-custom-tool --flag')
      expect(result.category).toBe('unknown')
      expect(result.confidence).toBeLessThan(0.5)
    })

    it('should handle commands with sudo prefix', async () => {
      const result = await classifyCommand('sudo apt install nginx')
      expect(result.category).toBe('package')
      expect(result.operation).toBe('install')
      expect(result).toHaveProperty('elevated')
      expect(result.elevated).toBe(true)
    })

    it('should handle commands with env prefix', async () => {
      const result = await classifyCommand('env NODE_ENV=production npm start')
      expect(result.category).toBe('development')
      expect(result.operation).toBe('run')
    })

    it('should handle command aliases', async () => {
      // ll is commonly aliased to ls -la
      const result = await classifyCommand('ll')
      expect(result.category).toBe('file')
      expect(result.operation).toBe('list')
    })
  })

  // ==========================================================================
  // Type Definitions
  // ==========================================================================
  describe('Type Definitions', () => {
    it('should export CommandCategory type', () => {
      const categories: CommandCategory[] = [
        'file',
        'process',
        'network',
        'system',
        'package',
        'development',
        'git',
        'container',
        'unknown',
      ]
      expect(categories).toHaveLength(9)
    })

    it('should have proper result structure type', () => {
      const mockResult: CommandClassificationResult = {
        category: 'file',
        operation: 'read',
        command: 'cat file.txt',
        confidence: 0.95,
        parsed: {
          binary: 'cat',
          args: ['file.txt'],
          flags: [],
        },
        risk: {
          level: 'low',
          reason: 'Read-only file operation',
        },
      }

      expect(mockResult.category).toBe('file')
      expect(mockResult.operation).toBe('read')
      expect(mockResult.confidence).toBe(0.95)
    })
  })
})
