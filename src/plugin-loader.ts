import * as fs from 'fs';
import * as path from 'path';
import { Plugin } from './types';
import { sanitizeUnicode } from './unicode-sanitizer';

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private pluginsDir: string;

  constructor(pluginsDir: string = './plugins') {
    this.pluginsDir = path.resolve(pluginsDir);
  }

  async loadPlugins(): Promise<void> {
    console.log(`Loading plugins from: ${this.pluginsDir}`);
    
    if (!fs.existsSync(this.pluginsDir)) {
      console.log('Plugins directory does not exist, creating it...');
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(this.pluginsDir);
    
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        try {
          const pluginPath = path.join(this.pluginsDir, file);
          console.log(`Loading plugin: ${file}`);
          
          // Dynamic import for ESM/CJS compatibility
          const module = require(pluginPath);
          const plugin: Plugin = module.default || module;
          
          if (this.isValidPlugin(plugin)) {
            this.plugins.set(plugin.name, plugin);
            console.log(`✓ Loaded plugin: ${plugin.name} with ${plugin.tools.length} tool(s)`);
          } else {
            console.warn(`✗ Invalid plugin format in ${file}`);
          }
        } catch (error) {
          console.error(`Error loading plugin ${file}:`, error);
        }
      }
    }
    
    console.log(`Total plugins loaded: ${this.plugins.size}`);
  }

  private isValidPlugin(plugin: any): plugin is Plugin {
    return (
      plugin &&
      typeof plugin.name === 'string' &&
      typeof plugin.description === 'string' &&
      Array.isArray(plugin.tools) &&
      typeof plugin.execute === 'function'
    );
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async executeToolCall(toolName: string, parameters: Record<string, any>): Promise<string> {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.find(t => t.name === toolName);
      if (tool) {
        console.log(`Executing tool: ${toolName} from plugin: ${plugin.name}`);
        const result = await plugin.execute(toolName, parameters);
        // Sanitize Unicode from tool results
        return sanitizeUnicode(result);
      }
    }
    throw new Error(`Tool not found: ${toolName}`);
  }

  getToolsForOllama(): any[] {
    const tools: any[] = [];
    
    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        });
      }
    }
    
    return tools;
  }
}
