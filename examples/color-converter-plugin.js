// Color converter plugin for the IRC bot
// Convert between different color formats: HEX, RGB, HSL

const plugin = {
  name: 'color-converter',
  description: 'Convert colors between HEX, RGB, and HSL. Use when users want a color in another format; validate input formats and ranges.',
  tools: [
    {
      name: 'convert_color',
      description: 'Convert a color from one format to another. Supports HEX (#RRGGBB), RGB (rgb(r,g,b)), and HSL (hsl(h,s%,l%)) formats.',
      parameters: {
        type: 'object',
        properties: {
          color: {
            type: 'string',
            description: 'Input color: HEX (#RRGGBB), RGB rgb(r,g,b) with 0-255, or HSL hsl(h, s%, l%) with 0-360/0-100/0-100.',
          },
          to_format: {
            type: 'string',
            description: 'Target format to convert to. Must be one of: hex, rgb, hsl.',
            enum: ['hex', 'rgb', 'hsl'],
          },
        },
        required: ['color', 'to_format'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'convert_color') {
      const color = parameters.color.trim();
      const toFormat = parameters.to_format.toLowerCase();
      
      try {
        // Parse the input color
        let rgb;
        
        // Try to parse as HEX
        const hexMatch = color.match(/^#?([0-9a-fA-F]{6})$/);
        if (hexMatch) {
          const hex = hexMatch[1];
          rgb = {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16),
          };
        }
        // Try to parse as RGB
        else {
          const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
          if (rgbMatch) {
            rgb = {
              r: parseInt(rgbMatch[1]),
              g: parseInt(rgbMatch[2]),
              b: parseInt(rgbMatch[3]),
            };
          }
          // Try to parse as HSL
          else {
            const hslMatch = color.match(/hsl\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/i);
            if (hslMatch) {
              const h = parseInt(hslMatch[1]);
              const s = parseInt(hslMatch[2]);
              const l = parseInt(hslMatch[3]);
              rgb = hslToRgb(h, s, l);
            }
          }
        }
        
        if (!rgb) {
          return 'Error: Invalid color format. Use HEX (#RRGGBB), RGB (rgb(r,g,b)), or HSL (hsl(h,s%,l%))';
        }
        
        // Validate RGB values
        if (rgb.r < 0 || rgb.r > 255 || rgb.g < 0 || rgb.g > 255 || rgb.b < 0 || rgb.b > 255) {
          return 'Error: RGB values must be between 0 and 255';
        }
        
        // Convert to target format
        let result;
        if (toFormat === 'hex') {
          result = rgbToHex(rgb.r, rgb.g, rgb.b);
        } else if (toFormat === 'rgb') {
          result = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        } else if (toFormat === 'hsl') {
          const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
          result = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
        } else {
          return 'Error: Invalid target format. Must be hex, rgb, or hsl';
        }
        
        return `${color} → ${result}`;
        
      } catch (error) {
        console.error('[color-converter] Error converting color:', error);
        return `Error converting color: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

// Helper function to convert RGB to HEX
function rgbToHex(r, g, b) {
  const toHex = (n) => {
    const hex = Math.round(n).toString(16).padStart(2, '0');
    return hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Helper function to convert RGB to HSL
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Helper function to convert HSL to RGB
function hslToRgb(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

module.exports = plugin;
