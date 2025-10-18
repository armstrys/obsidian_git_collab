import { App, MarkdownView, Notice, FileSystemAdapter } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SaveChangesModal, BranchSelectionModal } from './modals';

const execAsync = promisify(exec);

export class ReadOnlyOperations {
	private plugin: any;
	
	constructor(plugin: any) {
		this.plugin = plugin;
	}
	
	enableReadOnlyMode() {
		// Add CSS class to body for global styling
		document.body.classList.add('git-collab-readonly');
		document.body.classList.remove('git-collab-edit-mode');
		
		// Disable text input in all editors
		this.disableTextInput();
		
		// Disable file operations (create, delete, rename)
		this.disableFileOperations();
		
		// Apply read-only styles to current active view
		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			this.applyReadOnlyStyles(activeView);
		}
	}

	disableReadOnlyMode() {
		// Remove CSS class from body
		document.body.classList.remove('git-collab-readonly');
		document.body.classList.add('git-collab-edit-mode');
		
		// Re-enable text input
		this.enableTextInput();
		
		// Re-enable file operations
		this.enableFileOperations();
		
		// Remove read-only styles from current active view
		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			this.removeReadOnlyStyles(activeView);
		}
	}

	updateRibbonIcon() {
		if (this.plugin.settings.isReadOnlyMode) {
			this.plugin.ribbonIconEl.setAttribute('aria-label', 'Enable Edit Mode');
			this.plugin.ribbonIconEl.classList.add('git-collab-readonly-ribbon');
		} else {
			this.plugin.ribbonIconEl.setAttribute('aria-label', 'Enable Read-Only Protection');
			this.plugin.ribbonIconEl.classList.remove('git-collab-readonly-ribbon');
		}
	}

	async enableEditMode(branchName?: string) {
	   // If we have a repository connected and no specific branch was provided,
	   // show the branch selection modal first
	   if (this.plugin.settings.isRepositoryConnected && !branchName) {
	       // Show branch selection modal
	       new BranchSelectionModal(this.plugin.app, this.plugin).open();
	       return;
	   }
	   
	   // CRITICAL: Edit mode is NOT allowed on main branch
	   if (this.plugin.settings.isRepositoryConnected) {
	       const targetBranch = branchName || this.plugin.settings.currentBranch;
	       
	       if (targetBranch === this.plugin.settings.mainBranch) {
	           new Notice(`🚫 Cannot enable edit mode on ${this.plugin.settings.mainBranch} branch. Please select a different branch.`);
	           return;
	       }

	       // Ensure we're actually on the correct branch
	       try {
	           const adapter = this.plugin.app.vault.adapter;
	           if (adapter instanceof FileSystemAdapter) {
	               const vaultPath = (adapter as any).basePath || '';
	               await execAsync(`git checkout ${targetBranch}`, { cwd: vaultPath });
	           }
	       } catch (error) {
	           new Notice(`Failed to switch to branch ${targetBranch}: ${error.message}`);
	           return;
	       }
	   }

	   this.plugin.settings.isReadOnlyMode = false;
	   
	   if (this.plugin.settings.isRepositoryConnected && branchName) {
	       // Switch to the specified branch
	       this.plugin.settings.currentBranch = branchName;
	       this.plugin.settings.lastWorkingBranch = branchName;
	       new Notice(`✏️ Edit Mode enabled on branch: ${branchName}`);
	   } else {
	       new Notice('✏️ Edit Mode enabled - You can now modify files');
	   }
	   
	   await this.plugin.saveSettings();
	   this.plugin.readonlyOps.disableReadOnlyMode();
	   this.plugin.readonlyOps.updateStatusBar();
	   this.plugin.readonlyOps.updateRibbonIcon();
	   
	   // Validate rules after enabling edit mode
	   await this.plugin.gitOps.validateAndEnforceBranchRules();
	}

	async enableReadOnlyModeWithBranch() {
		try {
			// Check for uncommitted changes before switching
			if (this.plugin.settings.isRepositoryConnected && !this.plugin.settings.isReadOnlyMode) {
				const hasChanges = await this.plugin.gitOps.checkForUncommittedChanges();
				if (hasChanges) {
					// Show save dialog instead of immediately switching
					new SaveChangesModal(this.plugin.app, this.plugin).open();
					return; // Don't continue with read-only mode until user decides
				}
			}
			
			await this.plugin.readonlyOps.forceEnableReadOnlyMode();
		} catch (error) {
			console.error('Error enabling read-only mode with branch:', error);
			new Notice('⚠️ Error switching to read-only mode. Some operations may not work correctly.');
		}
	}

	async forceEnableReadOnlyMode() {
		try {
			this.plugin.settings.isReadOnlyMode = true;
			
			if (this.plugin.settings.isRepositoryConnected) {
				try {
					// Get the vault path for Git operations
					const adapter = this.plugin.app.vault.adapter;
					let vaultPath: string;
					
					if (adapter instanceof FileSystemAdapter) {
						vaultPath = (adapter as any).basePath || '';
						
						// CRITICAL: Read-only mode MUST be on main branch
						await execAsync(`git checkout ${this.plugin.settings.mainBranch}`, { cwd: vaultPath });
						
						// Update settings after successful checkout
						this.plugin.settings.currentBranch = this.plugin.settings.mainBranch;
						new Notice(`🔒 Read-Only Mode enabled - Switched to ${this.plugin.settings.mainBranch} branch`);
					} else {
						// Fallback if we can't access filesystem
						this.plugin.settings.currentBranch = this.plugin.settings.mainBranch;
						new Notice('🔒 Read-Only Mode enabled - Repository protection active');
					}
				} catch (error) {
					console.error('Failed to switch to main branch:', error);
					// This is critical - if we can't switch to main, we shouldn't enable read-only
					new Notice(`❌ Cannot enable read-only mode: Failed to switch to ${this.plugin.settings.mainBranch} branch`);
					this.plugin.settings.isReadOnlyMode = false; // Revert the setting
					return;
				}
			} else {
				new Notice('🔒 Read-Only Mode enabled - Vault is protected');
			}
			
			await this.plugin.saveSettings();
			this.plugin.readonlyOps.enableReadOnlyMode();
			this.plugin.readonlyOps.updateStatusBar();
			this.plugin.readonlyOps.updateRibbonIcon();
			
			// Validate rules after enabling read-only mode
			await this.plugin.gitOps.validateAndEnforceBranchRules();
		} catch (error) {
			console.error('Error in forceEnableReadOnlyMode:', error);
			new Notice('⚠️ Error enabling read-only mode. Some features may not work correctly.');
		}
	}

	disableFileOperations() {
		// Disable file creation, deletion, and renaming
		document.addEventListener('contextmenu', this.plugin.preventContextMenu, true);
		document.addEventListener('dragstart', this.plugin.preventDragDrop, true);
		document.addEventListener('drop', this.plugin.preventDragDrop, true);
		
		// Hide/disable file operation buttons
		const newFileButtons = document.querySelectorAll('.nav-action-button[aria-label*="New"], .clickable-icon[aria-label*="New"]');
		newFileButtons.forEach(btn => {
			(btn as HTMLElement).style.display = 'none';
		});
	}

	enableFileOperations() {
		// Re-enable file operations
		document.removeEventListener('contextmenu', this.plugin.preventContextMenu, true);
		document.removeEventListener('dragstart', this.plugin.preventDragDrop, true);
		document.removeEventListener('drop', this.plugin.preventDragDrop, true);
		
		// Show file operation buttons
		const newFileButtons = document.querySelectorAll('.nav-action-button[aria-label*="New"], .clickable-icon[aria-label*="New"]');
		newFileButtons.forEach(btn => {
			(btn as HTMLElement).style.display = '';
		});
	}

	disableTextInput() {
		// Prevent keyboard input in editors
		document.addEventListener('keydown', this.plugin.preventKeyInput, true);
		document.addEventListener('keypress', this.plugin.preventKeyInput, true);
		document.addEventListener('input', this.plugin.preventInput, true);
		
		// Prevent mouse text selection and editing
		document.addEventListener('mousedown', this.plugin.preventMouseEditing, true);
	}

	enableTextInput() {
		// Re-enable keyboard input
		document.removeEventListener('keydown', this.plugin.preventKeyInput, true);
		document.removeEventListener('keypress', this.plugin.preventKeyInput, true);
		document.removeEventListener('input', this.plugin.preventInput, true);
		
		// Re-enable mouse editing
		document.removeEventListener('mousedown', this.plugin.preventMouseEditing, true);
	}

	applyReadOnlyStyles(view: MarkdownView) {
		// Add read-only class to the view container
		const viewContainer = view.containerEl;
		viewContainer.classList.add('git-collab-readonly-editor');
	}

	removeReadOnlyStyles(view: MarkdownView) {
		// Remove read-only class from the view container
		const viewContainer = view.containerEl;
		viewContainer.classList.remove('git-collab-readonly-editor');
	}

	updateStatusBar() {
		if (this.plugin.settings.isReadOnlyMode) {
			this.plugin.statusBarItem.textContent = '🔒 READ-ONLY';
			this.plugin.statusBarItem.classList.add('git-collab-readonly-status');
		} else {
			this.plugin.statusBarItem.textContent = '✏️ EDIT MODE';
			this.plugin.statusBarItem.classList.remove('git-collab-readonly-status');
		}

		// Add Git connection status
		if (this.plugin.settings.isRepositoryConnected) {
			this.plugin.statusBarItem.textContent += ` | 🔗 ${this.plugin.settings.currentBranch}`;
		} else {
			this.plugin.statusBarItem.textContent += ' | ❌ No Git';
		}
	}
}