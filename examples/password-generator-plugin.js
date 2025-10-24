// Password generator plugin for the IRC bot
// Generate secure random passwords with customizable options

const crypto = require('crypto');

const plugin = {
  name: 'password-generator',
  description: 'Generate secure random passwords with customizable length and character sets. Useful for creating strong passwords for accounts and services.',
  tools: [
    {
      name: 'generate_password',
      description: 'Generate a secure random password with specified length and character types',
      parameters: {
        type: 'object',
        properties: {
          length: {
            type: 'number',
            description: 'Password length (default: 16, min: 8, max: 128)',
          },
          include_uppercase: {
            type: 'boolean',
            description: 'Include uppercase letters A-Z (default: true)',
          },
          include_lowercase: {
            type: 'boolean',
            description: 'Include lowercase letters a-z (default: true)',
          },
          include_numbers: {
            type: 'boolean',
            description: 'Include numbers 0-9 (default: true)',
          },
          include_symbols: {
            type: 'boolean',
            description: 'Include symbols !@#$%^&*()_+-=[]{}|;:,.<>? (default: true)',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'generate_password') {
      // Parse parameters with defaults
      const length = Math.min(Math.max(parameters.length || 16, 8), 128);
      const includeUppercase = parameters.include_uppercase !== false;
      const includeLowercase = parameters.include_lowercase !== false;
      const includeNumbers = parameters.include_numbers !== false;
      const includeSymbols = parameters.include_symbols !== false;
      
      // Build character set
      const charSets = [];
      const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const lowercase = 'abcdefghijklmnopqrstuvwxyz';
      const numbers = '0123456789';
      const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      
      if (includeUppercase) charSets.push(uppercase);
      if (includeLowercase) charSets.push(lowercase);
      if (includeNumbers) charSets.push(numbers);
      if (includeSymbols) charSets.push(symbols);
      
      // Ensure at least one character set is selected
      if (charSets.length === 0) {
        return 'Error: At least one character type must be enabled';
      }
      
      // Combine all character sets
      const allChars = charSets.join('');
      
      try {
        // Generate password ensuring at least one character from each enabled set
        let password = '';
        
        // First, add one random character from each enabled set
        for (const charSet of charSets) {
          const randomIndex = crypto.randomInt(0, charSet.length);
          password += charSet[randomIndex];
        }
        
        // Fill remaining length with random characters from all sets
        const remainingLength = length - password.length;
        for (let i = 0; i < remainingLength; i++) {
          const randomIndex = crypto.randomInt(0, allChars.length);
          password += allChars[randomIndex];
        }
        
        // Shuffle the password to avoid predictable patterns
        password = password.split('').sort(() => crypto.randomInt(0, 2) - 0.5).join('');
        
        // Build description of what's included
        const included = [];
        if (includeUppercase) included.push('uppercase');
        if (includeLowercase) included.push('lowercase');
        if (includeNumbers) included.push('numbers');
        if (includeSymbols) included.push('symbols');
        
        return `Generated password (${length} chars, ${included.join('+')}):\n${password}`;
        
      } catch (error) {
        console.error('[password-generator] Error generating password:', error);
        return `Error generating password: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
