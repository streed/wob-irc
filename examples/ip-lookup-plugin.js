// IP lookup plugin for the IRC bot
// Get information about an IP address using the ip-api.com free API

const plugin = {
  name: 'ip-lookup',
  description: 'Look up information about an IP address including location, ISP, and organization. Uses ip-api.com free API.',
  tools: [
    {
      name: 'lookup_ip',
      description: 'Get detailed information about an IP address including country, city, ISP, organization, timezone, and coordinates',
      parameters: {
        type: 'object',
        properties: {
          ip: {
            type: 'string',
            description: 'The IP address to look up (IPv4 or IPv6). If not provided, looks up the current IP.',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'lookup_ip') {
      const ip = parameters.ip ? parameters.ip.trim() : '';
      
      // Basic IP validation if provided
      if (ip) {
        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
        
        if (!ipv4Pattern.test(ip) && !ipv6Pattern.test(ip)) {
          return 'Error: Invalid IP address format. Please provide a valid IPv4 or IPv6 address.';
        }
      }
      
      try {
        // Use ip-api.com free API (no key required, rate limit: 45 requests/minute)
        const url = ip 
          ? `http://ip-api.com/json/${encodeURIComponent(ip)}`
          : 'http://ip-api.com/json/';
        
        const response = await fetch(url);
        
        if (!response.ok) {
          return `Error: Failed to fetch IP information (status ${response.status})`;
        }
        
        const data = await response.json();
        
        // Check if lookup was successful
        if (data.status === 'fail') {
          return `Error: ${data.message || 'Failed to look up IP address'}`;
        }
        
        // Build response with available information
        const parts = [];
        
        if (data.query) {
          parts.push(`IP: ${data.query}`);
        }
        
        if (data.country) {
          const location = [data.city, data.regionName, data.country].filter(Boolean).join(', ');
          parts.push(`Location: ${location}`);
        }
        
        if (data.isp) {
          parts.push(`ISP: ${data.isp}`);
        }
        
        if (data.org && data.org !== data.isp) {
          parts.push(`Org: ${data.org}`);
        }
        
        if (data.timezone) {
          parts.push(`Timezone: ${data.timezone}`);
        }
        
        if (data.lat && data.lon) {
          parts.push(`Coordinates: ${data.lat}, ${data.lon}`);
        }
        
        return parts.join(' | ');
        
      } catch (error) {
        console.error('[ip-lookup] Error looking up IP:', error);
        return `Error looking up IP address: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
