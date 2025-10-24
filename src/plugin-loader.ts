import * as fs from 'fs';
import * as path from 'path';
import { Plugin } from './types';
import { sanitizeUnicode } from './unicode-sanitizer';
import type { OllamaClient } from './ollama-client';

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private pluginsDir: string;
  private ollamaClient?: OllamaClient;

  constructor(pluginsDir: string = './plugins') {
    this.pluginsDir = path.resolve(pluginsDir);
  }

  /**
   * Set the OllamaClient to use for optimizing plugin descriptions
   */
  setOllamaClient(ollamaClient: OllamaClient): void {
    this.ollamaClient = ollamaClient;
  }

  /**
   * Optimize plugin descriptions using the LLM
   */
  private async optimizePluginDescriptions(plugin: Plugin): Promise<void> {
    if (!this.ollamaClient) {
      console.log(`  Skipping optimization for ${plugin.name} (no OllamaClient set)`);
      return;
    }

    console.log(`  Optimizing descriptions for plugin: ${plugin.name}`);

    try {
      // Optimize plugin description
      plugin.optimizedDescription = await this.ollamaClient.optimizeDescription(
        plugin.description,
        `This is a plugin named "${plugin.name}" with ${plugin.tools.length} tool(s)`
      );

      // Optimize each tool's description and parameter descriptions
      for (const tool of plugin.tools) {
        // Optimize tool description
        tool.optimizedDescription = await this.ollamaClient.optimizeDescription(
          tool.description,
          `This is a tool named "${tool.name}" in the "${plugin.name}" plugin`
        );

        // Optimize parameter descriptions
        if (tool.parameters.properties) {
          for (const [paramName, paramSpec] of Object.entries(tool.parameters.properties)) {
            paramSpec.optimizedDescription = await this.ollamaClient.optimizeDescription(
              paramSpec.description,
              `This is parameter "${paramName}" for tool "${tool.name}" in plugin "${plugin.name}". Parameter type: ${paramSpec.type}`
            );
          }
        }
      }

      console.log(`  ✓ Optimized descriptions for ${plugin.name}`);
    } catch (error) {
      console.error(`  ✗ Error optimizing descriptions for ${plugin.name}:`, error);
    }
  }

  /**
   * Register a built-in plugin (called before loadPlugins)
   */
  async registerBuiltinPlugin(plugin: Plugin): Promise<void> {
    if (this.isValidPlugin(plugin)) {
      this.plugins.set(plugin.name, plugin);
      console.log(`✓ Registered built-in plugin: ${plugin.name} with ${plugin.tools.length} tool(s)`);
      
      // Optimize descriptions if OllamaClient is available
      await this.optimizePluginDescriptions(plugin);
    } else {
      console.warn(`✗ Invalid built-in plugin format`);
    }
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
            
            // Optimize descriptions
            await this.optimizePluginDescriptions(plugin);
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
        // Use optimized description if available, otherwise use original
        const toolDescription = tool.optimizedDescription || tool.description;
        
        // Build parameters with optimized descriptions
        const parameters = {
          type: tool.parameters.type,
          properties: {} as Record<string, any>,
          required: tool.parameters.required,
        };
        
        // Copy properties with optimized descriptions
        for (const [paramName, paramSpec] of Object.entries(tool.parameters.properties)) {
          parameters.properties[paramName] = {
            type: paramSpec.type,
            description: paramSpec.optimizedDescription || paramSpec.description,
            ...(paramSpec.enum && { enum: paramSpec.enum }),
          };
        }
        
        tools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: toolDescription,
            parameters: parameters,
          },
        });
      }
    }
    
    return tools;
  }
}
