# Obsidian Git Collaboration Plugin

**Version:** 0.1.0  
**Author:** Ryan Armstrong

A comprehensive Obsidian plugin for Git repository synchronization with collaborative editing via branching, merging, and pull requests.

## Features

- **Secure Branch-Based Editing**: Read-only mode on main branch, edit mode on working branches
- **Intelligent Save Workflows**: Choose between draft commits or push & PR creation
- **GitHub Integration**: Automatic PR creation and repository management
- **Branch Management**: Visual interface for branch selection and creation
- **Repository Setup**: Clone existing repos or initialize new ones

## Installation

### Option 1: BRAT (Recommended for beta testing)
1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from Obsidian's Community Plugins
2. Open BRAT settings and add this repository
3. BRAT will automatically download and install the latest release

### Option 2: Manual Installation
1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/armstrys/obsidian_git_collab/releases) page
2. Copy them to your vault's `.obsidian/plugins/obsidian-git-collab/` directory
3. Enable the plugin in Obsidian's Community Plugins settings
4. Configure Git settings via the plugin settings tab

## Requirements

- Obsidian v0.15.0+
- GitHub account and personal access token for repository operations

## License

MIT License
