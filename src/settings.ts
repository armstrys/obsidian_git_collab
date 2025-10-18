import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { GitCollabSettings } from './main';
import { GitSetupModal, CloneRepositoryModal, GitIgnoreEditorModal } from './modals';

export class GitCollabSettingTab extends PluginSettingTab {
	plugin: any;

	constructor(app: App, plugin: any) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Git Collaboration Settings' });

		// Read-only mode setting
		new Setting(containerEl)
			.setName('Default to Read-Only Mode')
			.setDesc('Start the plugin in read-only mode for protection')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.isReadOnlyMode)
				.onChange(async (value) => {
					this.plugin.settings.isReadOnlyMode = value;
					await this.plugin.saveSettings();
					// Apply the change immediately
					if (value) {
						this.plugin.readonlyOps.enableReadOnlyMode();
					} else {
						this.plugin.readonlyOps.disableReadOnlyMode();
					}
					this.plugin.readonlyOps.updateStatusBar();
					this.plugin.readonlyOps.updateRibbonIcon();
				}));

		containerEl.createEl('h3', { text: 'Git Repository Configuration' });

		// Repository status
		const statusText = this.plugin.settings.isRepositoryConnected
			? `✅ Connected to: ${this.plugin.settings.repositoryUrl}`
			: '❌ No repository connected';
		containerEl.createEl('p', { text: statusText });

		// Repository URL (read-only display)
		if (this.plugin.settings.repositoryUrl) {
			new Setting(containerEl)
				.setName('Repository URL')
				.setDesc('Currently connected repository')
				.addText(text => text
					.setValue(this.plugin.settings.repositoryUrl)
					.setDisabled(true));
		}

		// Current branch
		if (this.plugin.settings.isRepositoryConnected) {
			new Setting(containerEl)
				.setName('Current Branch')
				.addText(text => text
					.setValue(this.plugin.settings.currentBranch)
					.setDisabled(true));
		}

		// User configuration
		new Setting(containerEl)
			.setName('Git User Name')
			.setDesc('Your name for Git commits')
			.addText(text => text
				.setPlaceholder('Your Name')
				.setValue(this.plugin.settings.userName)
				.onChange(async (value) => {
					this.plugin.settings.userName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Git User Email')
			.setDesc('Your email for Git commits')
			.addText(text => text
				.setPlaceholder('your.email@example.com')
				.setValue(this.plugin.settings.userEmail)
				.onChange(async (value) => {
					this.plugin.settings.userEmail = value;
					await this.plugin.saveSettings();
				}));

		// Note about tokens
		containerEl.createEl('p', {
			text: '💡 GitHub tokens are now stored per-repository for better security. Configure tokens when setting up each repository.',
			cls: 'setting-item-description'
		});

		// Action buttons
		containerEl.createEl('h3', { text: 'Repository Actions' });

		// .gitignore editor
		new Setting(containerEl)
			.setName('Edit .gitignore')
			.setDesc('Manage files and folders to ignore in Git commits')
			.addButton(button => button
				.setButtonText('📝 Edit .gitignore')
				.onClick(() => {
					new GitIgnoreEditorModal(this.app, this.plugin).open();
				}));

		if (!this.plugin.settings.isRepositoryConnected) {
			// Setup new repository
			new Setting(containerEl)
				.setName('Setup New Repository')
				.setDesc('Initialize this vault as a Git repository and push to GitHub')
				.addButton(button => button
					.setButtonText('Setup Repository')
					.onClick(() => {
						new GitSetupModal(this.app, this.plugin).open();
					}));

			// Clone existing repository
			new Setting(containerEl)
				.setName('Clone Existing Repository')
				.setDesc('Replace this vault with content from a GitHub repository')
				.addButton(button => button
					.setButtonText('Clone Repository')
					.onClick(() => {
						new CloneRepositoryModal(this.app, this.plugin).open();
					}));
		} else {
			// Disconnect repository
			new Setting(containerEl)
				.setName('Disconnect Repository')
				.setDesc('Remove Git connection (local files will remain)')
				.addButton(button => button
					.setButtonText('Disconnect')
					.setWarning()
					.onClick(async () => {
						const currentRepoUrl = this.plugin.settings.repositoryUrl;
						this.plugin.settings.isRepositoryConnected = false;
						this.plugin.settings.repositoryUrl = '';
						// Remove the token for this repository
						if (currentRepoUrl) {
							await this.plugin.removeRepositoryToken(currentRepoUrl);
						}
						await this.plugin.saveSettings();
						this.plugin.readonlyOps.updateStatusBar();
						this.display(); // Refresh the settings display
						new Notice('Repository disconnected');
					}));
		}
	}
}