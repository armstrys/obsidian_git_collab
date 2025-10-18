import { App, MarkdownView, Notice, FileSystemAdapter } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitCollabSettings } from './main';

const execAsync = promisify(exec);

export class GitOperations {
	private plugin: any;
	
	constructor(plugin: any) {
		this.plugin = plugin;
	}
	
	async validateAndEnforceBranchRules(): Promise<boolean> {
		if (!this.plugin.settings.isRepositoryConnected) {
			return true; // No repository, no rules to enforce
		}

		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			const { stdout: currentGitBranch } = await execAsync('git branch --show-current', { cwd: vaultPath });
			const actualBranch = currentGitBranch.trim();

			// VALIDATION: Ensure main branch setting is correct
			if (this.plugin.settings.mainBranch !== 'main' && actualBranch === 'main') {
				console.log('CORRECTING: Main branch setting should be "main"');
				this.plugin.settings.mainBranch = 'main';
				await this.plugin.saveSettings();
			}

			// RULE 1: Read-only mode MUST be on main branch
			if (this.plugin.settings.isReadOnlyMode && actualBranch !== this.plugin.settings.mainBranch) {
				console.log(`ENFORCING: Read-only mode requires main branch. Switching from '${actualBranch}' to '${this.plugin.settings.mainBranch}'`);
				await execAsync(`git checkout ${this.plugin.settings.mainBranch}`, { cwd: vaultPath });
				this.plugin.settings.currentBranch = this.plugin.settings.mainBranch;
				await this.plugin.saveSettings();
				new Notice(`🔒 Switched to ${this.plugin.settings.mainBranch} for read-only mode`);
				return true;
			}

			// RULE 2: Edit mode MUST NOT be on main branch
			if (!this.plugin.settings.isReadOnlyMode && actualBranch === this.plugin.settings.mainBranch) {
				console.log(`ENFORCING: Edit mode not allowed on main branch. Switching to read-only mode.`);
				this.plugin.settings.isReadOnlyMode = true;
				await this.plugin.saveSettings();
				this.plugin.readonlyOps.updateStatusBar();
				new Notice(`🚫 Cannot edit on ${this.plugin.settings.mainBranch} branch. Switched to read-only mode.`);
				return false;
			}

			// Update current branch to match reality
			if (actualBranch !== this.plugin.settings.currentBranch) {
				this.plugin.settings.currentBranch = actualBranch;
				await this.plugin.saveSettings();
			}

			// Update visual state
			this.plugin.readonlyOps.updateStatusBar();

			return true;
		} catch (error) {
			console.error('Branch validation failed:', error);
			return false;
		}
	}

	async checkForUncommittedChanges(): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return false;
			}

			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: vaultPath });
			return statusOutput.trim().length > 0;
		} catch (error) {
			console.error('Failed to check for uncommitted changes:', error);
			return false;
		}
	}

	async commitChanges(message: string): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return false;
			}

			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			
			// Add all changes
			await execAsync('git add .', { cwd: vaultPath });
			
			// Commit with message
			await execAsync(`git commit -m "${message}"`, { cwd: vaultPath });
			
			return true;
		} catch (error) {
			console.error('Failed to commit changes:', error);
			return false;
		}
	}

	async pushChanges(): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return false;
			}

			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			const currentBranch = this.plugin.settings.currentBranch;
			
			// First, fetch latest changes from remote
			try {
				await execAsync('git fetch origin', { cwd: vaultPath });
			} catch (fetchError) {
				console.log('Fetch failed, continuing with push:', fetchError);
			}
			
			// Check if local branch is behind remote
			try {
				const { stdout: behindCount } = await execAsync(
					`git rev-list --count HEAD..origin/${currentBranch}`, 
					{ cwd: vaultPath }
				);
				
				if (parseInt(behindCount.trim()) > 0) {
					// Local is behind, try to pull
					try {
						// Temporarily disable file deletion during pull
						this.plugin.isGitOperationInProgress = true;
						await execAsync(`git pull origin ${currentBranch}`, { cwd: vaultPath });
						new Notice(`📥 Pulled ${behindCount.trim()} update(s) from remote before pushing`);
					} catch (pullError) {
						console.error('Pull failed:', pullError);
						new Notice('❌ Cannot push: Local branch is behind remote and pull failed. Please resolve conflicts manually.');
						return false;
					} finally {
						// Always re-enable file deletion protection
						this.plugin.isGitOperationInProgress = false;
					}
				}
			} catch (checkError) {
				// Branch might not exist on remote yet, that's fine
				console.log('Could not check if branch is behind:', checkError);
			}
			
			// Now push the changes
			await execAsync(`git push origin ${currentBranch}`, { cwd: vaultPath });
			
			return true;
		} catch (error) {
			console.error('Failed to push changes:', error);
			return false;
		}
	}

	async isBranchOnRemote(branchName: string): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return false;
			}

			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			
			// Check if branch exists on remote
			await execAsync(`git ls-remote --exit-code origin ${branchName}`, { cwd: vaultPath });
			return true;
		} catch (error) {
			// Branch doesn't exist on remote
			return false;
		}
	}

	async createPullRequest(branchName: string, title: string, description: string, token?: string): Promise<boolean> {
		try {
			if (!this.plugin.settings.repositoryUrl) {
				return false;
			}

			// Extract repo info from URL
			const repoMatch = this.plugin.settings.repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
			if (!repoMatch) {
				new Notice('Cannot create PR: Invalid repository URL format');
				return false;
			}

			const [, owner, repo] = repoMatch;
			const finalToken = token || await this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
			
			if (!finalToken) {
				new Notice('Cannot create PR: GitHub token required');
				return false;
			}

			const prData = {
				title,
				body: description,
				head: branchName,
				base: this.plugin.settings.mainBranch
			};

			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
				method: 'POST',
				headers: {
					'Authorization': `token ${finalToken}`,
					'Content-Type': 'application/json',
					'Accept': 'application/vnd.github.v3+json'
				},
				body: JSON.stringify(prData)
			});

			if (response.ok) {
				const pr = await response.json();
				new Notice(`Pull Request created: #${pr.number}`);
				return true;
			} else {
				const error = await response.json();
				new Notice(`Failed to create PR: ${error.message || 'Unknown error'}`);
				return false;
			}
		} catch (error) {
			console.error('Failed to create pull request:', error);
			new Notice('Failed to create pull request');
			return false;
		}
	}

	// ============================================================================
	// PULL REQUEST MANAGEMENT API
	// ============================================================================

	async fetchPullRequests(): Promise<any[]> {
		try {
			const token = this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
			if (!token) {
				new Notice('GitHub token required for PR management. Please configure in settings.');
				return [];
			}

			const urlParts = this.plugin.settings.repositoryUrl.replace('.git', '').split('/');
			const owner = urlParts[urlParts.length - 2];
			const repo = urlParts[urlParts.length - 1];

			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
				headers: {
					'Authorization': `token ${token}`,
					'Accept': 'application/vnd.github.v3+json'
				}
			});

			if (response.ok) {
				return await response.json();
			} else {
				new Notice('Failed to fetch pull requests');
				return [];
			}
		} catch (error) {
			console.error('Failed to fetch pull requests:', error);
			new Notice('Failed to fetch pull requests');
			return [];
		}
	}

	async mergePullRequest(prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<boolean> {
		try {
			const token = this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
			if (!token) {
				new Notice('GitHub token required for PR management. Please configure in settings.');
				return false;
			}

			const urlParts = this.plugin.settings.repositoryUrl.replace('.git', '').split('/');
			const owner = urlParts[urlParts.length - 2];
			const repo = urlParts[urlParts.length - 1];

			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
				method: 'PUT',
				headers: {
					'Authorization': `token ${token}`,
					'Content-Type': 'application/json',
					'Accept': 'application/vnd.github.v3+json'
				},
				body: JSON.stringify({
					merge_method: mergeMethod
				})
			});

			if (response.ok) {
				new Notice(`Pull Request #${prNumber} merged successfully!`);
				return true;
			} else {
				const error = await response.json();
				new Notice(`Failed to merge PR: ${error.message || 'Unknown error'}`);
				return false;
			}
		} catch (error) {
			console.error('Failed to merge pull request:', error);
			new Notice('Failed to merge pull request');
			return false;
		}
	}

	async closePullRequest(prNumber: number): Promise<boolean> {
		try {
			const token = this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
			if (!token) {
				new Notice('GitHub token required for PR management. Please configure in settings.');
				return false;
			}

			const urlParts = this.plugin.settings.repositoryUrl.replace('.git', '').split('/');
			const owner = urlParts[urlParts.length - 2];
			const repo = urlParts[urlParts.length - 1];

			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
				method: 'PATCH',
				headers: {
					'Authorization': `token ${token}`,
					'Content-Type': 'application/json',
					'Accept': 'application/vnd.github.v3+json'
				},
				body: JSON.stringify({
					state: 'closed'
				})
			});

			if (response.ok) {
				new Notice(`Pull Request #${prNumber} closed`);
				return true;
			} else {
				const error = await response.json();
				new Notice(`Failed to close PR: ${error.message || 'Unknown error'}`);
				return false;
			}
		} catch (error) {
			console.error('Failed to close pull request:', error);
			new Notice('Failed to close pull request');
			return false;
		}
	}

	async pullLatestChanges(): Promise<boolean> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				new Notice('Cannot access vault directory for Git operations');
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			
			// Temporarily disable file deletion during pull
			this.plugin.isGitOperationInProgress = true;
			
			try {
				// Make sure we're on the main branch
				await execAsync(`git checkout ${this.plugin.settings.mainBranch}`, { cwd: vaultPath });
				
				// Pull latest changes
				await execAsync('git pull origin ' + this.plugin.settings.mainBranch, { cwd: vaultPath });
				
				new Notice(`✅ Pulled latest changes from ${this.plugin.settings.mainBranch}`);
				return true;
			} finally {
				// Always re-enable file deletion protection
				this.plugin.isGitOperationInProgress = false;
			}
		} catch (error) {
			console.error('Failed to pull latest changes:', error);
			new Notice('Failed to pull latest changes');
			return false;
		}
	}

	async createNewBranch(branchName: string): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				new Notice('No repository connected');
				return false;
			}

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				new Notice('Cannot access vault directory');
				return false;
			}

			// Create and switch to new branch
			await execAsync(`git checkout -b "${branchName}"`, { cwd: vaultPath });
			
			// Add to available branches list
			if (!this.plugin.settings.availableBranches.includes(branchName)) {
				this.plugin.settings.availableBranches.push(branchName);
				await this.plugin.saveSettings();
			}
			
			new Notice(`Branch "${branchName}" created successfully!`);
			return true;
		} catch (error) {
			console.error('Branch creation failed:', error);
			new Notice(`Failed to create branch: ${error.message}`);
			return false;
		}
	}

	async switchToBranch(branchName: string): Promise<boolean> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				new Notice('No repository connected');
				return false;
			}

			// CRITICAL VALIDATION: Check if branch switch is allowed
			if (this.plugin.settings.isReadOnlyMode && branchName !== this.plugin.settings.mainBranch) {
				new Notice(`🚫 Cannot switch to ${branchName} in read-only mode. Only ${this.plugin.settings.mainBranch} is allowed.`);
				return false;
			}

			if (!this.plugin.settings.isReadOnlyMode && branchName === this.plugin.settings.mainBranch) {
				new Notice(`🚫 Cannot switch to ${this.plugin.settings.mainBranch} in edit mode. Please use read-only mode for ${this.plugin.settings.mainBranch}.`);
				return false;
			}

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				new Notice('Cannot access vault directory');
				return false;
			}

			// Switch to the branch
			await execAsync(`git checkout "${branchName}"`, { cwd: vaultPath });
			
			// Update current branch setting
			this.plugin.settings.currentBranch = branchName;
			await this.plugin.saveSettings();
			this.plugin.readonlyOps.updateStatusBar();
			
			// Validate rules after branch switch
			await this.validateAndEnforceBranchRules();
			
			new Notice(`Switched to branch: ${branchName}`);
			return true;
		} catch (error) {
			console.error('Branch switch failed:', error);
			new Notice(`Failed to switch to branch: ${error.message}`);
			return false;
		}
	}

	async initializeGit() {
		try {
			// For now, we'll create a basic Git interface
			// This will be expanded in future versions to include actual Git operations
			console.log('Git interface initialized (basic mode)');
			
			// Check what the default branch actually is in the repository
			await this.detectDefaultBranch();
			
			// Check if there's already a repository URL configured
			if (this.plugin.settings.repositoryUrl) {
				this.plugin.settings.isRepositoryConnected = true;
			}
			
			this.plugin.readonlyOps.updateStatusBar();
		} catch (error) {
			console.log('Git initialization failed:', error);
			new Notice('Git functionality initialization failed');
		}
	}

	async performStartupChecks() {
		try {
			if (!this.plugin.settings.isRepositoryConnected || !this.plugin.settings.repositoryUrl) {
				return;
			}

			console.log('Performing startup repository checks...');

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				console.log('Cannot access vault directory for startup checks');
				return;
			}

			// Check if Git repository exists
			const fs = require('fs');
			const path = require('path');
			const gitDir = path.join(vaultPath, '.git');
			
			try {
				await fs.promises.access(gitDir);
			} catch (error) {
				new Notice('Git repository not found. Repository may need to be re-initialized.');
				this.plugin.settings.isRepositoryConnected = false;
				await this.plugin.saveSettings();
				this.plugin.readonlyOps.updateStatusBar();
				return;
			}

			// Check for uncommitted changes
			try {
				const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: vaultPath });
				if (statusOutput.trim()) {
					new Notice('⚠️ You have uncommitted changes in your repository');
				}
			} catch (error) {
				console.log('Could not check Git status:', error);
			}

			// Validate and enforce branch rules
			await this.validateAndEnforceBranchRules();

			// Check if remote is reachable and fetch updates (non-blocking)
			this.checkRemoteUpdates(vaultPath);

		} catch (error) {
			console.log('Startup checks failed:', error);
		}
	}

	async checkRemoteUpdates(vaultPath: string) {
		try {
			// Fetch from remote to check for updates (non-blocking)
			const token = await this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
			if (token || this.isPublicRepository(this.plugin.settings.repositoryUrl)) {
				setTimeout(async () => {
					try {
						await execAsync('git fetch origin', { cwd: vaultPath });
						
						// Check if current branch is behind
						const { stdout: behindOutput } = await execAsync(
							`git rev-list --count HEAD..origin/${this.plugin.settings.currentBranch}`, 
							{ cwd: vaultPath }
						);
						
						const behindCount = parseInt(behindOutput.trim()) || 0;
						if (behindCount > 0) {
							new Notice(`📥 ${behindCount} update(s) available from remote repository`);
						}
					} catch (error) {
						console.log('Could not check for remote updates:', error);
					}
				}, 2000); // Check after 2 seconds to avoid blocking startup
			}
		} catch (error) {
			console.log('Remote update check failed:', error);
		}
	}

	isPublicRepository(url: string): boolean {
		// Simple check for public repositories
		return !!(url && !url.includes('private') && !url.includes('github.com:'));
	}

	async detectDefaultBranch() {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return;
			}

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				return;
			}

			// Get current branch
			const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: vaultPath });
			const branchName = currentBranch.trim();

			if (branchName) {
				// If we're on master, switch to main and delete master
				if (branchName === 'master') {
					try {
						await execAsync('git checkout -b main', { cwd: vaultPath });
						await execAsync('git branch -d master', { cwd: vaultPath });
						this.plugin.settings.currentBranch = 'main';
						this.plugin.settings.mainBranch = 'main';
						new Notice('Switched from master to main branch');
					} catch (error) {
						console.log('Branch migration from master to main failed:', error);
					}
				} else {
					this.plugin.settings.currentBranch = branchName;
					
					// Properly detect the default branch instead of assuming
					try {
						// Try to get the default branch from remote
						const { stdout: remoteInfo } = await execAsync('git remote show origin', { cwd: vaultPath });
						const defaultMatch = remoteInfo.match(/HEAD branch: (\w+)/);
						if (defaultMatch) {
							this.plugin.settings.mainBranch = defaultMatch[1];
						} else {
							// Fallback: look for main or master in branch list
							const { stdout: allBranches } = await execAsync('git branch -r', { cwd: vaultPath });
							if (allBranches.includes('origin/main')) {
								this.plugin.settings.mainBranch = 'main';
							} else if (allBranches.includes('origin/master')) {
								this.plugin.settings.mainBranch = 'master';
							} else {
								// Last resort: use 'main' as default
								this.plugin.settings.mainBranch = 'main';
							}
						}
					} catch (error) {
						console.log('Could not detect default branch, using main:', error);
						this.plugin.settings.mainBranch = 'main';
					}
				}
				
				// Get all branches
				const { stdout: allBranches } = await execAsync('git branch -a', { cwd: vaultPath });
				const branches = allBranches
					.split('\n')
					.map(b => b.replace('*', '').trim())
					.filter(b => b && !b.startsWith('remotes/'))
					.map(b => b.replace('origin/', ''))
					.filter(b => b !== 'master'); // Filter out master branch
				
				this.plugin.settings.availableBranches = [...new Set(branches)];
				await this.plugin.saveSettings();
			}
		} catch (error) {
			console.log('Branch detection failed:', error);
			// If we can't detect branches, we might not be in a git repo yet
		}
	}

	async ensureGitignoreExists(vaultPath: string): Promise<void> {
		try {
			const gitignorePath = `${vaultPath}/.gitignore`;
			const fs = require('fs');
			const path = require('path');
			
			// Check if .gitignore already exists
			try {
				await fs.promises.access(gitignorePath);
				// If it exists, check if it contains .obsidian
				const content = await fs.promises.readFile(gitignorePath, 'utf8');
				if (!content.includes('.obsidian')) {
					// Add .obsidian to existing .gitignore
					const newContent = content.trim() + '\n\n# Obsidian configuration (added by Git Collab plugin)\n.obsidian/\n';
					await fs.promises.writeFile(gitignorePath, newContent);
					new Notice('.gitignore updated to exclude .obsidian folder');
				}
			} catch (error) {
				// .gitignore doesn't exist, create it
				const gitignoreContent = `# Obsidian configuration (added by Git Collab plugin)
.obsidian/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Temporary files
*.tmp
*.temp
*~
`;
				await fs.promises.writeFile(gitignorePath, gitignoreContent);
				new Notice('.gitignore created to exclude .obsidian folder');
			}
		} catch (error) {
			console.error('Failed to create/update .gitignore:', error);
			new Notice('Warning: Could not create .gitignore file');
		}
	}

	async cloneRepository(url: string, token: string): Promise<boolean> {
		// SET FLAG EARLY - before any file operations that might trigger events
		this.plugin.isGitOperationInProgress = true;

		try {
			new Notice('Cloning repository...');

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				new Notice('Cannot access vault directory');
				return false;
			}

			// Allow cloning even if there's existing data - overwrite existing files
			// We'll remove existing files first (except .obsidian and .git)
			const fs = require('fs');
			const path = require('path');
			let files;
			try {
				files = await fs.promises.readdir(vaultPath);
			} catch (error) {
				new Notice('Cannot read vault directory');
				return false;
			}
			
			// Remove all files except .obsidian and .git directories
			const filesToRemove = files.filter((file: string) =>
				file !== '.obsidian' &&
				file !== '.git' &&
				!file.startsWith('.tmp') &&
				!file.startsWith('.temp')
			);
			
			for (const file of filesToRemove) {
				const filePath = path.join(vaultPath, file);
				try {
					const stat = await fs.promises.stat(filePath);
					if (stat.isDirectory()) {
						await fs.promises.rm(filePath, { recursive: true });
					} else {
						await fs.promises.unlink(filePath);
					}
				} catch (error) {
					console.error(`Failed to remove existing file: ${filePath}`, error);
				}
			}
			
			// Special handling for .git directory - remove it if it exists
			const gitDirPath = path.join(vaultPath, '.git');
			try {
				const stat = await fs.promises.stat(gitDirPath);
				if (stat.isDirectory()) {
					await fs.promises.rm(gitDirPath, { recursive: true });
				}
			} catch (error) {
				// .git directory doesn't exist or can't be removed, that's fine
			}

			// Clone the repository into a temporary directory first
			const pathUtil = require('path');
			const crypto = require('crypto');
			const tempDirName = `.temp-clone-${crypto.randomBytes(4).toString('hex')}`;
			const tempDir = pathUtil.join(vaultPath, tempDirName);
			
			try {
				// Create authenticated URL
				const authenticatedUrl = this.getAuthenticatedUrl(url, token);
				
				// Clone into temp directory
				await execAsync(`git clone "${authenticatedUrl}" "${tempDir}"`, { cwd: vaultPath });
				
				// Move all files from temp directory to vault root (except .git)
				const clonedFiles = await fs.promises.readdir(tempDir);
				for (const file of clonedFiles) {
					const pathUtil = require('path');
					const srcPath = pathUtil.join(tempDir, file);
					const destPath = pathUtil.join(vaultPath, file);
					await fs.promises.rename(srcPath, destPath);
				}
				
				// Clean up temp directory
				try {
					await fs.promises.rmdir(tempDir);
				} catch (cleanupError) {
					// Ignore cleanup errors
				}
				
				// Ensure .gitignore exists and excludes .obsidian
				await this.ensureGitignoreExists(vaultPath);
				
				// Set up Git configuration
				if (this.plugin.settings.userName) {
					await execAsync(`git config user.name "${this.plugin.settings.userName}"`, { cwd: vaultPath });
				}
				if (this.plugin.settings.userEmail) {
					await execAsync(`git config user.email "${this.plugin.settings.userEmail}"`, { cwd: vaultPath });
				}

				// Get current branch and ensure it's main
				try {
					const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: vaultPath });
					const branchName = currentBranch.trim();
					
					if (branchName === 'master') {
						await execAsync('git checkout -b main', { cwd: vaultPath });
						await execAsync('git branch -d master', { cwd: vaultPath });
						new Notice('Migrated from master to main branch');
					}
					
					this.plugin.settings.currentBranch = branchName === 'master' ? 'main' : branchName;
					this.plugin.settings.mainBranch = 'main';
				} catch (error) {
					this.plugin.settings.currentBranch = 'main';
					this.plugin.settings.mainBranch = 'main';
				}

				// Get all branches
				try {
					const { stdout: allBranches } = await execAsync('git branch -a', { cwd: vaultPath });
					const branches = allBranches
						.split('\n')
						.map(b => b.replace('*', '').trim())
						.filter(b => b && !b.startsWith('remotes/'))
						.map(b => b.replace('origin/', ''))
						.filter(b => b !== 'master'); // Filter out master branch
				
					this.plugin.settings.availableBranches = [...new Set(branches)];
				} catch (error) {
					this.plugin.settings.availableBranches = ['main'];
				}

				// Store repository configuration
				this.plugin.settings.repositoryUrl = url;
				await this.plugin.setRepositoryToken(url, token);
				this.plugin.settings.isRepositoryConnected = true;
				await this.plugin.saveSettings();

				// Update status bar and refresh vault
				this.plugin.readonlyOps.updateStatusBar();
				
				// Force Obsidian to refresh the file explorer and vault
				await this.plugin.app.vault.adapter.list('');
				
				// Trigger a workspace layout update
				this.plugin.app.workspace.trigger('layout-change');
				
				new Notice('Repository cloned successfully! Files should now appear in your vault.');

				return true;
			} catch (cloneError) {
				// Clean up temp directory if it exists
				try {
					await fs.promises.rmdir(tempDir, { recursive: true });
				} catch (cleanupError) {
					// Ignore cleanup errors
				}
				throw cloneError;
			}
		} catch (error) {
			console.error('Clone failed:', error);
			new Notice(`Failed to clone repository: ${error.message}`);
			return false;
		} finally {
			// Always re-enable file deletion protection
			this.plugin.isGitOperationInProgress = false;
		}
	}

	async initializeRepository(url: string, token: string): Promise<boolean> {
		try {
			new Notice('Initializing Git repository...');

			// Get the vault path
			const adapter = this.plugin.app.vault.adapter;
			let vaultPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				vaultPath = (adapter as any).basePath || '';
			} else {
				new Notice('Cannot access vault directory');
				return false;
			}

			// Initialize git repository
			await execAsync('git init', { cwd: vaultPath });
			
			// Set user configuration
			if (this.plugin.settings.userName) {
				await execAsync(`git config user.name "${this.plugin.settings.userName}"`, { cwd: vaultPath });
			}
			if (this.plugin.settings.userEmail) {
				await execAsync(`git config user.email "${this.plugin.settings.userEmail}"`, { cwd: vaultPath });
			}

			// Set default branch name to main
			await execAsync('git branch -M main', { cwd: vaultPath });
			
			// Ensure we're on main and remove any master branch if it exists
			try {
				await execAsync('git checkout main', { cwd: vaultPath });
				// Try to delete master branch if it exists (suppress error if it doesn't exist)
				await execAsync('git branch -d master', { cwd: vaultPath }).catch(() => {});
			} catch (error) {
				console.log('Branch cleanup completed');
			}

			// Ensure .gitignore exists and excludes .obsidian
			await this.ensureGitignoreExists(vaultPath);

			// Add all files
			await execAsync('git add .', { cwd: vaultPath });
			
			// Initial commit
			await execAsync('git commit -m "Initial commit from Obsidian Git Collaboration"', { cwd: vaultPath });

			// Add remote origin
			const authenticatedUrl = this.getAuthenticatedUrl(url, token);
			await execAsync(`git remote add origin "${authenticatedUrl}"`, { cwd: vaultPath });

			// Push to remote
			await execAsync('git push -u origin main', { cwd: vaultPath });

			this.plugin.settings.repositoryUrl = url;
			await this.plugin.setRepositoryToken(url, token);
			this.plugin.settings.isRepositoryConnected = true;
			this.plugin.settings.currentBranch = 'main';
			this.plugin.settings.mainBranch = 'main';
			this.plugin.settings.availableBranches = ['main'];
			await this.plugin.saveSettings();

			new Notice('Repository initialized and pushed successfully!');
			return true;
		} catch (error) {
			console.error('Repository initialization failed:', error);
			new Notice(`Failed to initialize repository: ${error.message}`);
			return false;
		}
	}

	private getAuthenticatedUrl(url: string, token: string): string {
		// Convert HTTPS GitHub URL to authenticated format
		if (url.includes('github.com')) {
			const urlParts = url.replace('https://github.com/', '').replace('.git', '');
			// If no token provided, use the URL as-is for public repositories
			if (!token) {
				return `https://github.com/${urlParts}.git`;
			}
			return `https://${token}@github.com/${urlParts}.git`;
		}
		return url;
	}

	async refreshAvailableBranches(): Promise<void> {
		try {
			if (!this.plugin.settings.isRepositoryConnected) {
				return;
			}

			const adapter = this.plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return;
			}

			const vaultPath = (adapter as any).basePath || '';

			// Get all local branches
			const { stdout: allBranches } = await execAsync('git branch', { cwd: vaultPath });
			const branches = allBranches
				.split('\n')
				.map(b => b.replace('*', '').trim())
				.filter(b => b && b !== 'master'); // Filter out master branch

			this.plugin.settings.availableBranches = [...new Set(branches)];
			await this.plugin.saveSettings();
		} catch (error) {
			console.error('Failed to refresh available branches:', error);
		}
	}
}