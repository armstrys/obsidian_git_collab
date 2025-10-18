import { App, Modal, Notice, Setting, FileSystemAdapter } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// BRANCH SELECTION MODAL
// ============================================================================

export class BranchSelectionModal extends Modal {
	plugin: any;

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Refresh available branches from git before displaying
		await this.plugin.gitOps.refreshAvailableBranches();

		contentEl.createEl('h2', { text: 'Select Branch for Editing' });
		contentEl.createEl('p', { 
			text: 'Choose a branch to work on or create a new one. Read-only mode keeps you on the main branch.' 
		});

		// Current branch info
		contentEl.createEl('div', { 
			text: `📍 Currently on: ${this.plugin.settings.currentBranch}`,
			cls: 'git-branch-current'
		});

		// Available branches section
		if (this.plugin.settings.availableBranches.length > 0) {
			contentEl.createEl('h3', { text: 'Switch to Existing Branch' });
			
			const branchList = contentEl.createEl('div', { cls: 'git-branch-list' });
			
			this.plugin.settings.availableBranches.forEach((branch: string) => {
				const branchItem = branchList.createEl('div', { cls: 'git-branch-item' });
				
				const branchButton = branchItem.createEl('button', { 
					text: `🌿 ${branch}`,
					cls: 'git-branch-button'
				});
				
				// Highlight the last working branch
				if (branch === this.plugin.settings.lastWorkingBranch) {
					branchButton.classList.add('git-branch-last-working');
					branchButton.textContent = `🔄 ${branch} (last working)`;
				}
				
				// Disable main branch (read-only)
				if (branch === this.plugin.settings.mainBranch) {
					branchButton.textContent = `🔒 ${branch} (read-only)`;
					branchButton.disabled = true;
				}
				
				branchButton.onclick = async () => {
					if (branch !== this.plugin.settings.mainBranch) {
						await this.plugin.gitOps.switchToBranch(branch);
						await this.plugin.readonlyOps.enableEditMode(branch);
						this.close();
					}
				};
			});
		}

		// Create new branch section
		contentEl.createEl('h3', { text: 'Create New Branch' });
		
		let newBranchName = '';
		
		const branchNameContainer = contentEl.createDiv('git-new-branch-container');
		
		new Setting(branchNameContainer)
			.setName('New Branch Name')
			.setDesc('Create a new branch for your edits')
			.addText(text => text
				.setPlaceholder('feature/my-edits')
				.onChange(async (value) => {
					newBranchName = value;
				}));

		// Suggested branch names
		const suggestionsContainer = contentEl.createDiv('git-branch-suggestions');
		suggestionsContainer.createEl('p', { text: 'Quick suggestions:' });
		
		const suggestions = [
			`edit-${new Date().toISOString().split('T')[0]}`,
			'feature/new-content',
			'draft/work-in-progress',
			'personal/notes'
		];

		suggestions.forEach(suggestion => {
			const suggestionButton = suggestionsContainer.createEl('button', {
				text: suggestion,
				cls: 'git-branch-suggestion'
			});
			suggestionButton.onclick = () => {
				newBranchName = suggestion;
				const textInput = branchNameContainer.querySelector('input') as HTMLInputElement;
				if (textInput) textInput.value = suggestion;
			};
		});

		// Action buttons
		const buttonContainer = contentEl.createDiv('git-branch-buttons');
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl('button', { text: 'Create & Edit' });
		createButton.style.cssText = 'background: var(--interactive-accent); color: white;';
		createButton.onclick = async () => {
			if (!newBranchName.trim()) {
				new Notice('Please enter a branch name');
				return;
			}

			// Create new branch and switch to it
			const success = await this.plugin.gitOps.createNewBranch(newBranchName.trim());
			if (success) {
				await this.plugin.gitOps.switchToBranch(newBranchName.trim());
				await this.plugin.readonlyOps.enableEditMode(newBranchName.trim());
				this.close();
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// GIT SETUP MODAL
// ============================================================================

export class GitSetupModal extends Modal {
	plugin: any;

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Setup Git Repository' });
		contentEl.createEl('p', { 
			text: 'Initialize your vault as a Git repository and push to GitHub.' 
		});

		// Initialize with existing values
		let repositoryUrl = this.plugin.settings.repositoryUrl;
		let githubToken = '';
		let userName = this.plugin.settings.userName;
		let userEmail = this.plugin.settings.userEmail;

		// Repository URL
		new Setting(contentEl)
			.setName('GitHub Repository URL')
			.setDesc('The HTTPS URL of your GitHub repository (e.g., https://github.com/username/repo.git)')
			.addText(text => text
				.setPlaceholder('https://github.com/username/repo.git')
				.setValue(this.plugin.settings.repositoryUrl)
				.onChange(async (value) => {
					repositoryUrl = value;
					// Update the token field based on the repository
					const savedToken = this.plugin.getRepositoryToken(value);
					if (savedToken) {
						githubToken = savedToken;
						// Update placeholder to show we have a saved token for this repo
						const tokenInput = contentEl.querySelector('input[type="password"]') as HTMLInputElement;
						if (tokenInput) {
							tokenInput.placeholder = 'Using saved token for this repository';
						}
					} else {
						githubToken = '';
						const tokenInput = contentEl.querySelector('input[type="password"]') as HTMLInputElement;
						if (tokenInput) {
							tokenInput.placeholder = 'ghp_xxxxxxxxxxxxxxxxxxxx';
						}
					}
				}));

		// GitHub Token
		const savedTokenForRepo = this.plugin.getRepositoryToken(repositoryUrl);
		new Setting(contentEl)
			.setName('GitHub Personal Access Token (Optional)')
			.setDesc('Token with repo access for this repository. Leave empty for public repositories.')
			.addText(text => {
				text.inputEl.type = 'password';
				const placeholder = savedTokenForRepo ? 'Using saved token for this repository' : 'Optional for public repos - ghp_xxxxxxxxxxxxxxxxxxxx';
				text.setPlaceholder(placeholder)
					.setValue('') // Don't show the actual token for security
					.onChange(async (value) => {
						githubToken = value;
					});
			});

		// User Name
		new Setting(contentEl)
			.setName('Git User Name')
			.setDesc('Your name for Git commits')
			.addText(text => text
				.setPlaceholder('Your Name')
				.setValue(this.plugin.settings.userName)
				.onChange(async (value) => {
					userName = value;
				}));

		// User Email
		new Setting(contentEl)
			.setName('Git User Email')
			.setDesc('Your email for Git commits')
			.addText(text => text
				.setPlaceholder('your.email@example.com')
				.setValue(this.plugin.settings.userEmail)
				.onChange(async (value) => {
					userEmail = value;
				}));

		// Buttons
		const buttonContainer = contentEl.createDiv('git-setup-buttons');
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const setupButton = buttonContainer.createEl('button', { text: 'Initialize & Push' });
		setupButton.style.cssText = 'background: var(--interactive-accent); color: white;';
		setupButton.onclick = async () => {
			// Use saved token for repository if no new token provided
			const savedToken = this.plugin.getRepositoryToken(repositoryUrl);
			const finalToken = githubToken || savedToken;
			
			if (!repositoryUrl || !userName || !userEmail) {
				new Notice('Please fill in repository URL, user name, and email');
				return;
			}

			// For public repositories, token is optional
			if (!finalToken && !this.plugin.gitOps.isPublicRepository(repositoryUrl)) {
				new Notice('Private repositories require a GitHub token. Leave token empty for public repositories.');
				return;
			}

			this.plugin.settings.userName = userName;
			this.plugin.settings.userEmail = userEmail;
			await this.plugin.saveSettings();

			const success = await this.plugin.gitOps.initializeRepository(repositoryUrl, finalToken || '');
			if (success) {
				this.close();
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// CLONE REPOSITORY MODAL
// ============================================================================

export class CloneRepositoryModal extends Modal {
	plugin: any;

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Clone Repository' });
		contentEl.createEl('p', { 
			text: 'Clone an existing GitHub repository to this vault.' 
		});

		// Initialize with existing values
		let repositoryUrl = '';
		let githubToken = '';

		// Repository URL
		new Setting(contentEl)
			.setName('GitHub Repository URL')
			.setDesc('The HTTPS URL of the repository to clone')
			.addText(text => text
				.setPlaceholder('https://github.com/username/repo.git')
				.onChange(async (value) => {
					repositoryUrl = value;
					// Update the token field based on the repository
					const savedToken = this.plugin.getRepositoryToken(value);
					if (savedToken) {
						githubToken = savedToken;
						// Update placeholder to show we have a saved token for this repo
						const tokenInput = contentEl.querySelector('input[type="password"]') as HTMLInputElement;
						if (tokenInput) {
							tokenInput.placeholder = 'Using saved token for this repository';
						}
					} else {
						githubToken = '';
						const tokenInput = contentEl.querySelector('input[type="password"]') as HTMLInputElement;
						if (tokenInput) {
							tokenInput.placeholder = 'ghp_xxxxxxxxxxxxxxxxxxxx';
						}
					}
				}));

		// GitHub Token
		new Setting(contentEl)
			.setName('GitHub Personal Access Token (Optional)')
			.setDesc('Token with repo access for this repository. Leave empty for public repositories.')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Optional for public repos - ghp_xxxxxxxxxxxxxxxxxxxx')
					.setValue('') // Don't show the actual token for security
					.onChange(async (value) => {
						githubToken = value;
					});
			});

		// Warning
		contentEl.createEl('div', { 
			text: '⚠️ Warning: This will replace all content in your current vault with the repository content.',
			cls: 'mod-warning'
		});

		// Buttons
		const buttonContainer = contentEl.createDiv('git-clone-buttons');
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const cloneButton = buttonContainer.createEl('button', { text: 'Clone Repository' });
		cloneButton.style.cssText = 'background: var(--interactive-accent); color: white;';
		cloneButton.onclick = async () => {
			// Use saved token for repository if no new token provided
			const savedToken = this.plugin.getRepositoryToken(repositoryUrl);
			const finalToken = githubToken || savedToken;
			
			if (!repositoryUrl) {
				new Notice('Please provide a repository URL');
				return;
			}

			// For public repositories, token is optional
			if (!finalToken && !this.plugin.gitOps.isPublicRepository(repositoryUrl)) {
				new Notice('Private repositories require a GitHub token. Leave token empty for public repositories.');
				return;
			}

			const success = await this.plugin.gitOps.cloneRepository(repositoryUrl, finalToken || '');
			if (success) {
				this.close();
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// COLLABORATIVE WORKFLOW MODALS
// ============================================================================

/**
 * PullRequestManagerModal - Comprehensive PR management interface
 * Allows viewing, reviewing, merging, and closing pull requests
 */
export class PullRequestManagerModal extends Modal {
	plugin: any;
	pullRequests: any[] = [];

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '🔀 Pull Request Manager' });
		
		// Loading indicator
		const loadingEl = contentEl.createEl('p', { text: '🔄 Loading pull requests...' });

		try {
			this.pullRequests = await this.plugin.gitOps.fetchPullRequests();
			loadingEl.remove();
			
			if (this.pullRequests.length === 0) {
				contentEl.createEl('p', { 
					text: '✨ No open pull requests found.',
					attr: { style: 'text-align: center; color: var(--text-muted); margin: 20px 0;' }
				});
				this.addRefreshButton(contentEl);
				return;
			}

			this.renderPullRequests(contentEl);
		} catch (error) {
			loadingEl.remove();
			contentEl.createEl('p', { 
				text: '❌ Failed to load pull requests. Please check your connection and token.',
				attr: { style: 'color: var(--text-error);' }
			});
			this.addRefreshButton(contentEl);
		}
	}

	addRefreshButton(contentEl: HTMLElement) {
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'text-align: center; margin: 20px 0;';
		
		const refreshButton = buttonContainer.createEl('button', { text: '🔄 Refresh' });
		refreshButton.style.cssText = 'background: var(--interactive-accent); color: white; padding: 8px 16px;';
		refreshButton.onclick = () => {
			this.onOpen();
		};
	}

	renderPullRequests(contentEl: HTMLElement) {
		const prContainer = contentEl.createDiv();
		prContainer.style.cssText = 'max-height: 400px; overflow-y: auto;';

		this.pullRequests.forEach(pr => {
			this.renderSinglePR(prContainer, pr);
		});

		// Add refresh button at the bottom
		this.addRefreshButton(contentEl);
	}

	renderSinglePR(container: HTMLElement, pr: any) {
		const prEl = container.createDiv();
		prEl.style.cssText = `
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 16px;
			margin: 12px 0;
			background: var(--background-secondary);
		`;

		// PR Header
		const headerEl = prEl.createDiv();
		headerEl.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;';

		const titleEl = headerEl.createEl('h3');
		titleEl.style.cssText = 'margin: 0; flex: 1;';
		titleEl.innerHTML = `#${pr.number}: ${pr.title}`;

		const statusEl = headerEl.createEl('span');
		statusEl.style.cssText = `
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 0.8em;
			font-weight: bold;
			background: ${this.getPRStatusColor(pr)};
			color: white;
		`;
		statusEl.textContent = this.getPRStatusText(pr);

		// PR Details
		const detailsEl = prEl.createDiv();
		detailsEl.style.cssText = 'margin: 8px 0; color: var(--text-muted); font-size: 0.9em;';
		detailsEl.innerHTML = `
			<div><strong>Branch:</strong> ${pr.head.ref} → ${pr.base.ref}</div>
			<div><strong>Author:</strong> ${pr.user.login}</div>
			<div><strong>Created:</strong> ${new Date(pr.created_at).toLocaleDateString()}</div>
		`;

		// PR Description
		if (pr.body && pr.body.trim()) {
			const descEl = prEl.createDiv();
			descEl.style.cssText = `
				margin: 12px 0;
				padding: 8px;
				background: var(--background-primary);
				border-radius: 4px;
				font-size: 0.9em;
				max-height: 100px;
				overflow-y: auto;
			`;
			descEl.textContent = pr.body.substring(0, 300) + (pr.body.length > 300 ? '...' : '');
		}

		// Action Buttons
		const actionsEl = prEl.createDiv();
		actionsEl.style.cssText = 'display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;';

		// View on GitHub button
		const viewButton = actionsEl.createEl('button', { text: '👀 View on GitHub' });
		viewButton.style.cssText = 'background: var(--background-modifier-border); padding: 6px 12px; font-size: 0.9em;';
		viewButton.onclick = () => {
			window.open(pr.html_url, '_blank');
		};

		// Merge button (only if mergeable or unknown - not if conflicts)
		if (pr.mergeable !== false) {
			const mergeButton = actionsEl.createEl('button', { text: '✅ Merge' });
			mergeButton.style.cssText = 'background: var(--color-green); color: white; padding: 6px 12px; font-size: 0.9em;';
			mergeButton.onclick = () => this.showMergeOptions(pr);
		}

		// Close button
		const closeButton = actionsEl.createEl('button', { text: '❌ Close' });
		closeButton.style.cssText = 'background: var(--color-red); color: white; padding: 6px 12px; font-size: 0.9em;';
		closeButton.onclick = () => this.confirmClosePR(pr);
	}

	async showMergeOptions(pr: any) {
		const mergeModal = new Modal(this.app);
		const { contentEl } = mergeModal;
		
		contentEl.createEl('h3', { text: `Merge PR #${pr.number}` });
		contentEl.createEl('p', { text: pr.title });

		const optionsEl = contentEl.createDiv();
		optionsEl.style.cssText = 'margin: 20px 0;';

		// Merge method selection
		optionsEl.createEl('h4', { text: 'Merge Method:' });
		
		let mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge';
		
		const methodContainer = optionsEl.createDiv();
		methodContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin: 10px 0;';

		const methods = [
			{ value: 'merge', label: '🔀 Create merge commit', desc: 'Preserves branch history' },
			{ value: 'squash', label: '📦 Squash and merge', desc: 'Combines all commits into one' },
			{ value: 'rebase', label: '📏 Rebase and merge', desc: 'Replays commits without merge commit' }
		];

		methods.forEach(method => {
			const radio = methodContainer.createEl('label');
			radio.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;';
			
			const input = radio.createEl('input');
			input.type = 'radio';
			input.name = 'mergeMethod';
			input.value = method.value;
			input.checked = method.value === 'merge';
			input.onchange = () => { mergeMethod = method.value as any; };
			
			const labelText = radio.createEl('div');
			labelText.innerHTML = `<strong>${method.label}</strong><br><small style="color: var(--text-muted);">${method.desc}</small>`;
		});

		// Action buttons
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => mergeModal.close();

		const confirmButton = buttonContainer.createEl('button', { text: '✅ Merge Pull Request' });
		confirmButton.style.cssText = 'background: var(--color-green); color: white;';
		confirmButton.onclick = async () => {
			const success = await this.plugin.gitOps.mergePullRequest(pr.number, mergeMethod);
			if (success) {
				mergeModal.close();
				this.onOpen(); // Refresh the PR list
				
				// Switch back to main branch and pull changes
				setTimeout(async () => {
					try {
						await this.plugin.readonlyOps.enableReadOnlyModeWithBranch();
						await this.plugin.gitOps.pullLatestChanges();
					} catch (error) {
						console.error('Error during post-merge operations:', error);
						new Notice('⚠️ Merge completed, but there was an issue updating the local repository. You may need to manually pull changes.');
					}
				}, 1000);
			}
		};

		mergeModal.open();
	}

	getPRStatusColor(pr: any): string {
		if (pr.mergeable === true) return 'var(--color-green)';
		if (pr.mergeable === false) return 'var(--color-red)';
		return 'var(--color-orange)'; // null or unknown state
	}

	getPRStatusText(pr: any): string {
		if (pr.mergeable === true) return 'Ready';
		if (pr.mergeable === false) return 'Conflicts';
		return 'Checking'; // null or unknown state
	}

	async confirmClosePR(pr: any) {
		const closeModal = new Modal(this.app);
		const { contentEl } = closeModal;
		
		contentEl.createEl('h3', { text: `Close PR #${pr.number}?` });
		contentEl.createEl('p', { text: pr.title });
		contentEl.createEl('p', { 
			text: 'This will close the pull request without merging. This action cannot be undone.',
			attr: { style: 'color: var(--text-muted); font-size: 0.9em;' }
		});

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => closeModal.close();

		const confirmButton = buttonContainer.createEl('button', { text: '❌ Close Pull Request' });
		confirmButton.style.cssText = 'background: var(--color-red); color: white;';
		confirmButton.onclick = async () => {
			const success = await this.plugin.gitOps.closePullRequest(pr.number);
			if (success) {
				closeModal.close();
				this.onOpen(); // Refresh the PR list
			}
		};

		closeModal.open();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * SaveChangesModal - Prompts user when uncommitted changes are detected
 * Provides options to save as draft (local commit) or save & push to GitHub
 */
export class SaveChangesModal extends Modal {
	plugin: any;
	currentBranch: string;

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
		this.currentBranch = plugin.settings.currentBranch;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '💾 Save Your Changes' });
		contentEl.createEl('p', { 
			text: `You have uncommitted changes on branch "${this.currentBranch}". What would you like to do?`
		});

		// Show current changes
		this.displayChanges(contentEl);

		// Commit message input
		const messageContainer = contentEl.createDiv();
		messageContainer.createEl('h3', { text: 'Commit Message' });
		
		let commitMessage = `Update notes from ${this.currentBranch}`;
		const messageInput = messageContainer.createEl('textarea');
		messageInput.style.cssText = 'width: 100%; height: 60px; margin: 10px 0;';
		messageInput.placeholder = 'Describe your changes...';
		messageInput.value = commitMessage;
		messageInput.addEventListener('input', () => {
			commitMessage = messageInput.value;
		});

		// Action buttons
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: space-between;';

		// Left side - Cancel
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.style.cssText = 'background: var(--background-modifier-border);';
		cancelButton.onclick = () => this.close();

		// Right side - Save options
		const saveContainer = buttonContainer.createDiv();
		saveContainer.style.cssText = 'display: flex; gap: 10px;';

		const draftButton = saveContainer.createEl('button', { text: '📝 Save as Draft' });
		draftButton.style.cssText = 'background: var(--color-orange); color: white;';
		draftButton.onclick = async () => {
			await this.saveAsDraft(commitMessage);
		};

		const pushButton = saveContainer.createEl('button', { text: '🚀 Save & Push' });
		pushButton.style.cssText = 'background: var(--interactive-accent); color: white;';
		pushButton.onclick = async () => {
			await this.saveAndPush(commitMessage);
		};
	}

	async displayChanges(contentEl: HTMLElement) {
		try {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return;
			}

			const vaultPath = (adapter as any).basePath || '';
			const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: vaultPath });
			
			if (statusOutput.trim()) {
				const changesDiv = contentEl.createDiv();
				changesDiv.style.cssText = `
					background: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 12px;
					margin: 15px 0;
					max-height: 150px;
					overflow-y: auto;
				`;
				
				changesDiv.createEl('h4', { text: 'Changed Files:' });
				const changesList = changesDiv.createEl('ul');
				const changes = statusOutput.trim().split('\n').slice(0, 10);
				changes.forEach(change => {
					const listItem = changesList.createEl('li');
					listItem.textContent = change.trim();
					listItem.style.fontFamily = 'var(--font-monospace)';
					listItem.style.fontSize = '0.9em';
				});
				
				if (statusOutput.trim().split('\n').length > 10) {
					changesDiv.createEl('p', { text: '...and more changes' });
				}
			}
		} catch (error) {
			console.error('Failed to display changes:', error);
		}
	}

	async saveAsDraft(message: string) {
		if (!message.trim()) {
			new Notice('Please enter a commit message');
			return;
		}

		try {
			// Double-check we're not on main branch
			if (this.currentBranch === this.plugin.settings.mainBranch) {
				new Notice(`🚫 Cannot commit to ${this.plugin.settings.mainBranch}. Please switch to a working branch first.`);
				return;
			}

			const success = await this.plugin.gitOps.commitChanges(message);
			if (success) {
				new Notice(`💾 Changes saved as draft on ${this.currentBranch}`);
				await this.plugin.readonlyOps.forceEnableReadOnlyMode();
				this.close();
			} else {
				new Notice('Failed to save changes as draft');
			}
		} catch (error) {
			new Notice('Error saving draft');
			console.error('Save draft failed:', error);
		}
	}

	async saveAndPush(message: string) {
		if (!message.trim()) {
			new Notice('Please enter a commit message');
			return;
		}

		try {
			// Double-check we're not on main branch
			if (this.currentBranch === this.plugin.settings.mainBranch) {
				new Notice(`🚫 Cannot commit to ${this.plugin.settings.mainBranch}. Please switch to a working branch first.`);
				return;
			}

			// First commit the changes
			const commitSuccess = await this.plugin.gitOps.commitChanges(message);
			if (!commitSuccess) {
				new Notice('Failed to commit changes');
				return;
			}

			// Check if this is a new branch
			const isNewBranch = !(await this.plugin.gitOps.isBranchOnRemote(this.currentBranch));

			// Push the changes
			const pushSuccess = await this.plugin.gitOps.pushChanges();
			if (!pushSuccess) {
				new Notice('Failed to push changes');
				return;
			}

			new Notice(`🚀 Changes pushed to ${this.currentBranch}`);

			// If it's a new branch, offer to create a PR
			if (isNewBranch && this.currentBranch !== this.plugin.settings.mainBranch) {
				setTimeout(() => {
					new CreatePRModal(this.app, this.plugin, this.currentBranch, message).open();
				}, 1000);
			}

			await this.plugin.readonlyOps.forceEnableReadOnlyMode();
			this.close();
		} catch (error) {
			new Notice('Error saving and pushing changes');
			console.error('Save and push failed:', error);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * CreatePRModal - Facilitates pull request creation for new branches
 * Auto-triggered when pushing new branches to GitHub
 */
export class CreatePRModal extends Modal {
	plugin: any;
	branchName: string;
	defaultMessage: string;

	constructor(app: App, plugin: any, branchName: string, defaultMessage: string) {
		super(app);
		this.plugin = plugin;
		this.branchName = branchName;
		this.defaultMessage = defaultMessage;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '🔀 Create Pull Request' });
		contentEl.createEl('p', { 
			text: `Branch "${this.branchName}" has been pushed to GitHub. Would you like to create a pull request to merge into ${this.plugin.settings.mainBranch}?`
		});

		// Check if we have a token
		const existingToken = this.plugin.getRepositoryToken(this.plugin.settings.repositoryUrl);
		let githubToken = existingToken || '';
		let tokenInput: HTMLInputElement | null = null;

		// Token input (only show if no token saved)
		if (!existingToken) {
			const tokenContainer = contentEl.createDiv();
			tokenContainer.createEl('h3', { text: 'GitHub Personal Access Token' });
			tokenContainer.createEl('p', { 
				text: 'A GitHub token is required to create pull requests. You can generate one at: https://github.com/settings/tokens',
				attr: { style: 'color: var(--text-muted); font-size: 0.9em;' }
			});
			
			tokenInput = tokenContainer.createEl('input');
			tokenInput.type = 'password';
			tokenInput.style.cssText = 'width: 100%; margin: 10px 0;';
			tokenInput.placeholder = 'ghp_xxxxxxxxxxxxxxxxxxxx';
			tokenInput.addEventListener('input', () => {
				githubToken = tokenInput!.value;
			});
		} else {
			contentEl.createEl('p', { 
				text: '✅ Using saved GitHub token for this repository.',
				attr: { style: 'color: var(--text-success); font-size: 0.9em;' }
			});
		}

		// PR Title
		let prTitle = `${this.branchName}: ${this.defaultMessage}`;
		const titleContainer = contentEl.createDiv();
		titleContainer.createEl('h3', { text: 'Pull Request Title' });
		const titleInput = titleContainer.createEl('input');
		titleInput.style.cssText = 'width: 100%; margin: 10px 0;';
		titleInput.value = prTitle;
		titleInput.addEventListener('input', () => {
			prTitle = titleInput.value;
		});

		// PR Description
		let prDescription = `Changes made in branch ${this.branchName}:\n\n${this.defaultMessage}`;
		const descContainer = contentEl.createDiv();
		descContainer.createEl('h3', { text: 'Description' });
		const descInput = descContainer.createEl('textarea');
		descInput.style.cssText = 'width: 100%; height: 80px; margin: 10px 0;';
		descInput.value = prDescription;
		descInput.addEventListener('input', () => {
			prDescription = descInput.value;
		});

		// Action buttons
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

		const skipButton = buttonContainer.createEl('button', { text: 'Skip' });
		skipButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl('button', { text: '🔀 Create Pull Request' });
		createButton.style.cssText = 'background: var(--interactive-accent); color: white;';
		createButton.onclick = async () => {
			// Get the token value - either from saved token or from input field
			let finalToken = existingToken;
			if (tokenInput) {
				finalToken = tokenInput.value.trim();
			}

			if (!finalToken) {
				new Notice('Please provide a GitHub personal access token');
				return;
			}

			try {
				// Save the token if it was newly entered
				if (!existingToken && finalToken) {
					this.plugin.setRepositoryToken(this.plugin.settings.repositoryUrl, finalToken);
				}

				const success = await this.plugin.gitOps.createPullRequest(this.branchName, prTitle, prDescription, finalToken);
				if (success) {
					this.close();
				}
			} catch (error) {
				new Notice('Failed to create pull request');
				console.error('Create PR failed:', error);
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// GITIGNORE EDITOR MODAL
// ============================================================================

/**
 * GitIgnoreEditorModal - Allows editing of the .gitignore file
 * Since Obsidian doesn't show dotfiles, this provides a way to manage .gitignore
 */
export class GitIgnoreEditorModal extends Modal {
	plugin: any;
	currentContent: string = '';

	constructor(app: App, plugin: any) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '📝 Edit .gitignore' });
		contentEl.createEl('p', { 
			text: 'Manage files and folders that should be ignored by Git. Since Obsidian doesn\'t show dotfiles, use this editor to configure your .gitignore.'
		});

		// Loading indicator
		const loadingEl = contentEl.createEl('p', { text: '🔄 Loading .gitignore...' });

		try {
			// Read current .gitignore content
			this.currentContent = await this.readGitIgnore();
			loadingEl.remove();

			// Create textarea for editing
			const editorContainer = contentEl.createDiv();
			editorContainer.createEl('h3', { text: 'Git Ignore Rules' });

			const textarea = editorContainer.createEl('textarea');
			textarea.style.cssText = `
				width: 100%;
				height: 300px;
				font-family: var(--font-monospace);
				font-size: 14px;
				line-height: 1.4;
				padding: 12px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background: var(--background-primary);
				color: var(--text-normal);
				resize: vertical;
			`;
			textarea.placeholder = `# Example .gitignore rules:
# Obsidian configuration
.obsidian/

# OS generated files
.DS_Store
Thumbs.db

# Temporary files
*.tmp
*.temp

# Logs
*.log

# Node modules (if any)
node_modules/`;
			textarea.value = this.currentContent;

			// Add helpful info
			const infoEl = contentEl.createDiv();
			infoEl.style.cssText = `
				background: var(--background-secondary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				padding: 12px;
				margin: 15px 0;
				font-size: 0.9em;
				color: var(--text-muted);
			`;
			infoEl.innerHTML = `
				<strong>💡 Tips:</strong><br>
				• One pattern per line<br>
				• Use # for comments<br>
				• Use * for wildcards (e.g., *.log)<br>
				• Use / for directory patterns (e.g., temp/)<br>
				• Use ! to negate patterns (e.g., !important.txt)
			`;

			// Action buttons
			const buttonContainer = contentEl.createDiv();
			buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: space-between;';

			// Left side - Cancel
			const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
			cancelButton.onclick = () => this.close();

			// Right side - Save options
			const saveContainer = buttonContainer.createDiv();
			saveContainer.style.cssText = 'display: flex; gap: 10px;';

			const resetButton = saveContainer.createEl('button', { text: '🔄 Reset to Default' });
			resetButton.style.cssText = 'background: var(--color-orange); color: white;';
			resetButton.onclick = () => {
				const defaultContent = `# Ignore all files starting with a dot (.) except .gitignore
.*
!.gitignore

`;
				textarea.value = defaultContent;
			};

			const saveButton = saveContainer.createEl('button', { text: '💾 Save .gitignore' });
			saveButton.style.cssText = 'background: var(--interactive-accent); color: white;';
			saveButton.onclick = async () => {
				const newContent = textarea.value;
				const success = await this.saveGitIgnore(newContent);
				if (success) {
					this.close();
				}
			};

		} catch (error) {
			loadingEl.remove();
			contentEl.createEl('p', { 
				text: '❌ Failed to load .gitignore file.',
				attr: { style: 'color: var(--text-error);' }
			});

			// Still allow creating a new .gitignore
			const createButton = contentEl.createEl('button', { text: '📝 Create New .gitignore' });
			createButton.style.cssText = 'background: var(--interactive-accent); color: white; margin-top: 10px;';
			createButton.onclick = () => {
				this.currentContent = '';
				this.onOpen(); // Re-render with empty content
			};
		}
	}

	async readGitIgnore(): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error('File system adapter not available');
		}

		const vaultPath = (adapter as any).basePath || '';
		const gitignorePath = `${vaultPath}/.gitignore`;

		try {
			const fs = require('fs').promises;
			const content = await fs.readFile(gitignorePath, 'utf8');
			return content;
		} catch (error) {
			// File doesn't exist, return empty string
			if (error.code === 'ENOENT') {
				return '';
			}
			throw error;
		}
	}

	async saveGitIgnore(content: string): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				new Notice('❌ File system adapter not available');
				return false;
			}

			const vaultPath = (adapter as any).basePath || '';
			const gitignorePath = `${vaultPath}/.gitignore`;

			const fs = require('fs').promises;
			await fs.writeFile(gitignorePath, content, 'utf8');

			new Notice('✅ .gitignore saved successfully');
			return true;
		} catch (error) {
			console.error('Failed to save .gitignore:', error);
			new Notice(`❌ Failed to save .gitignore: ${error.message}`);
			return false;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}