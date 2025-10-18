<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Obsidian Plugin Development Instructions

## Project Context
This workspace is for developing an Obsidian plugin. The plugin will be built iteratively with features added one at a time.

## Key Guidelines
1. **Plugin Structure**: Follow Obsidian plugin conventions:
   - Use TypeScript for type safety
   - Implement the Plugin class from obsidian API
   - Use proper manifest.json structure
   - Follow Obsidian's API patterns and lifecycle methods

2. **Development Approach**:
   - Build features incrementally
   - Test each feature in the test_vault before proceeding
   - Maintain clean, readable code with proper error handling
   - Use Obsidian's built-in UI components when possible

3. **File Organization**:
   - Keep main plugin logic in main.ts
   - Separate complex features into their own modules
   - Use proper imports from the obsidian package
   - Maintain consistent coding style

4. **Testing Strategy**:
   - Use the test_vault folder for testing plugin functionality
   - Verify each feature works correctly before adding new ones
   - Test edge cases and error conditions

5. **Code Quality**:
   - Use TypeScript types from the obsidian package
   - Implement proper error handling
   - Add meaningful comments for complex logic
   - Follow Obsidian's plugin development best practices
