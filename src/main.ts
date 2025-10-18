/**
 * Obsidian Git Collaboration Plugin
 *
 * A comprehensive plugin for Git repository synchronization with collaborative editing.
 * Features include read-only mode protection, branch management, and commit/push workflows.
 *
 * Author: Ryan Armstrong
 * Version: 0.0.5
 */

import { App, Plugin, Notice, TFile, FileSystemAdapter } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitOperations } from './git';
import { ReadOnlyOperations } from './readonly';
import { GitCollabSettingTab } from './settings';
import { BranchSelectionModal, PullRequestManagerModal } from './modals';

const execAsync = promisify(exec);

export interface GitCollabSettings {
	isReadOnlyMode: boolean;
	repositoryUrl: string;
	isRepositoryConnected: boolean;
	currentBranch: string;
	userEmail: string;
	userName: string;
	mainBranch: string;
	availableBranches: string[];
	lastWorkingBranch: string;
	repositoryTokens: Record<string, string>;
}

export const DEFAULT_SETTINGS: GitCollabSettings = {
	isReadOnlyMode: true,
	repositoryUrl: '',
	isRepositoryConnected: false,
	currentBranch: 'main',
	userEmail: '',
	userName: '',
	mainBranch: 'main',
	availableBranches: ['main'],
	lastWorkingBranch: '',
	repositoryTokens: {}
};

export default class ObsidianGitCollabPlugin extends Plugin {
	settings: GitCollabSettings;
	private gitOps: GitOperations;
	private readonlyOps: ReadOnlyOperations;
	private statusBarItem: HTMLElement;
	private ribbonIconEl: HTMLElement;
	private isGitOperationInProgress: boolean = false;

	async onload() {
		console.log('Loading Obsidian Git Collaboration plugin v0.0.5');
		
		await this.loadSettings();
		
		// Initialize operations classes
		this.gitOps = new GitOperations(this);
		this.readonlyOps = new ReadOnlyOperations(this);

		// Add settings tab
		this.addSettingTab(new GitCollabSettingTab(this.app, this));

		// Initialize status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.readonlyOps.updateStatusBar();

		// Initialize ribbon icon
		this.ribbonIconEl = this.addRibbonIcon('lock', 'Toggle Read-Only Mode', () => {
			if (this.settings.isReadOnlyMode) {
				this.readonlyOps.enableEditMode();
			} else {
				this.readonlyOps.enableReadOnlyModeWithBranch();
			}
		});
		this.readonlyOps.updateRibbonIcon();

		// Add command palette commands
		this.addCommand({
			id: 'toggle-read-only-mode',
			name: 'Toggle Read-Only Mode',
			callback: () => {
				if (this.settings.isReadOnlyMode) {
					this.readonlyOps.enableEditMode();
				} else {
					this.readonlyOps.enableReadOnlyModeWithBranch();
				}
			}
		});

		this.addCommand({
			id: 'select-branch-for-editing',
			name: 'Select Branch for Editing',
			callback: () => {
				new BranchSelectionModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'manage-pull-requests',
			name: 'Manage Pull Requests',
			callback: () => {
				new PullRequestManagerModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'pull-latest-changes',
			name: 'Pull Latest Changes',
			callback: () => {
				this.gitOps.pullLatestChanges();
			}
		});

		// Initialize read-only mode if enabled
		if (this.settings.isReadOnlyMode) {
			this.readonlyOps.enableReadOnlyMode();
		} else {
			this.readonlyOps.disableReadOnlyMode();
		}
		
		// Add event listener for new file creation
		this.app.vault.on('create', (file) => {
			if (this.settings.isReadOnlyMode && file instanceof TFile && !this.isGitOperationInProgress) {
				this.deleteNewFile(file);
			}
		});
	}

	onunload() {
		console.log('Unloading Obsidian Git Collaboration plugin v0.0.5');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Migrate any existing tokens to normalized URLs
		this.migrateRepositoryTokens();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ========================
	// TOKEN MIGRATION METHODS
	// ========================

	migrateRepositoryTokens() {
		const migratedTokens: Record<string, string> = {};
		let hasChanges = false;

		for (const [url, token] of Object.entries(this.settings.repositoryTokens)) {
			const normalizedUrl = this.normalizeRepositoryUrl(url);
			if (normalizedUrl !== url) {
				// URL was normalized, migrate the token
				migratedTokens[normalizedUrl] = token;
				hasChanges = true;
			} else {
				// URL is already normalized
				migratedTokens[url] = token;
			}
		}

		if (hasChanges) {
			this.settings.repositoryTokens = migratedTokens;
			this.saveSettings();
		}
	}

	// ========================
	// UI UPDATE METHODS
	// ========================

	// ========================
	// EDIT MODE METHODS
	// ========================

	// ========================
	// BRANCH MANAGEMENT METHODS
	// ========================

	// ========================
	// GIT OPERATIONS METHODS
	// ========================

	// ========================
	// PULL REQUEST METHODS
	// ========================

	// ========================
	// OTHER METHODS
	// ========================

	// ========================
	// TOKEN MANAGEMENT METHODS
	// ========================

	getRepositoryToken(repositoryUrl: string) {
		const normalizedUrl = this.normalizeRepositoryUrl(repositoryUrl);
		return this.settings.repositoryTokens[normalizedUrl];
	}

	setRepositoryToken(repositoryUrl: string, token: string) {
		const normalizedUrl = this.normalizeRepositoryUrl(repositoryUrl);
		this.settings.repositoryTokens[normalizedUrl] = token;
		this.saveSettings();
	}

	removeRepositoryToken(repositoryUrl: string) {
		const normalizedUrl = this.normalizeRepositoryUrl(repositoryUrl);
		delete this.settings.repositoryTokens[normalizedUrl];
		this.saveSettings();
	}

	// ========================
	// URL NORMALIZATION METHODS
	// ========================

	normalizeRepositoryUrl(url: string): string {
		// Normalize GitHub URLs to ensure consistent token storage/retrieval
		if (url.includes('github.com')) {
			// Remove https:// prefix, .git suffix, and normalize to https://github.com/owner/repo format
			let normalized = url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
			if (normalized.startsWith('github.com/')) {
				return `https://github.com/${normalized.substring(11)}`;
			}
		}
		// For non-GitHub URLs, return as-is
		return url;
	}

	// ========================
	// REPOSITORY CHECK METHODS
	// ========================

	// ========================
	// EVENT HANDLERS
	// ========================

	preventContextMenu = (event: Event) => {
		if (this.settings.isReadOnlyMode) {
			// Allow context menu in modals and command palette
			const target = event.target as HTMLElement;
			if (target.closest('.modal') || target.closest('.prompt') || target.closest('.suggestion-container')) {
				return;
			}
			event.preventDefault();
		}
	}

	preventDragDrop = (event: Event) => {
		if (this.settings.isReadOnlyMode) {
			// Allow drag and drop in modals and command palette
			const target = event.target as HTMLElement;
			if (target.closest('.modal') || target.closest('.prompt') || target.closest('.suggestion-container')) {
				return;
			}
			event.preventDefault();
		}
	}

	preventKeyInput = (event: KeyboardEvent) => {
		if (this.settings.isReadOnlyMode) {
			// Allow key input in modals and command palette
			const target = event.target as HTMLElement;
			if (target.closest('.modal') || target.closest('.prompt') || target.closest('.suggestion-container')) {
				return;
			}
			// Allow global shortcuts (Ctrl/Cmd+Q, Ctrl/Cmd+W, etc.) and function keys
			if ((event.ctrlKey || event.metaKey) &&
			   (event.key === 'q' || event.key === 'w' || event.key === 'r' || event.key === 's' || event.key === 'o' || event.key === 'p')) {
				return;
			}
			// Allow navigation keys and other essential keys
			const navigationKeys = ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
			if (navigationKeys.includes(event.key)) {
				return;
			}
			// Prevent all key input except Ctrl/Cmd+A (select all)
			if (!(event.ctrlKey || event.metaKey) || event.key !== 'a') {
				event.preventDefault();
			}
		}
	}

	preventInput = (event: Event) => {
		if (this.settings.isReadOnlyMode) {
			// Allow input in modals and command palette
			const target = event.target as HTMLElement;
			if (target.closest('.modal') || target.closest('.prompt') || target.closest('.suggestion-container')) {
				return;
			}
			event.preventDefault();
		}
	}

	preventMouseEditing = (event: MouseEvent) => {
		if (this.settings.isReadOnlyMode) {
			// Allow mouse editing in modals and command palette
			const target = event.target as HTMLElement;
			if (target.closest('.modal') || target.closest('.prompt') || target.closest('.suggestion-container')) {
				return;
			}
			event.preventDefault();
		}
	}
	// ========================
	// BRANCH RULE VALIDATION METHODS
	// ========================
	
	// ========================
	// REPOSITORY CLONE METHODS
	// ========================
	
	/**
	 * Delete a newly created file when in read-only mode
	 * Only deletes untracked files (not tracked by git and not ignored)
	 */
	async deleteNewFile(file: TFile) {
		try {
			// Get the vault path
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				console.error('Cannot access vault directory for git operations');
				return;
			}
			
			const vaultPath = (adapter as any).basePath || '';
			const filePath = file.path;
			
			// Check if file is ignored by git
			try {
				await execAsync(`git check-ignore "${filePath}"`, { cwd: vaultPath });
				// File is ignored, don't delete
				return;
			} catch (error) {
				// File is not ignored, continue checking
			}
			
			// Check if file is tracked by git
			try {
				await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd: vaultPath });
				// File is tracked, don't delete
				return;
			} catch (error) {
				// File is not tracked, continue to deletion
			}
			
			// File is untracked and not ignored, delete it
			await this.app.vault.delete(file);
			new Notice(`🔒 File "${file.name}" was deleted as read-only mode is enabled.`);
		} catch (error) {
			console.error('Failed to delete new file:', error);
			new Notice(`❌ Failed to delete new file "${file.name}": ${error.message}`);
		}
	}
}