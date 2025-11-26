// Currency converter plugin for the IRC bot
// Converts between different currencies using the exchangerate.host API (free, no API key required)

const plugin = {
  name: 'currency',
  description: 'Convert amounts between currencies using live rates. Use when asked “X in Y”; require ISO currency codes (e.g., USD, EUR).',
  tools: [
    {
      name: 'convert_currency',
      description: 'Convert an amount from one currency to another using current exchange rates',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Amount to convert (> 0). Decimals allowed.',
          },
          from: {
            type: 'string',
            description: 'Source currency code (ISO 4217, 3 letters, uppercase e.g., USD, EUR, JPY).',
          },
          to: {
            type: 'string',
            description: 'Target currency code (ISO 4217, 3 letters, uppercase e.g., USD, EUR, JPY).',
          },
        },
        required: ['amount', 'from', 'to'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'convert_currency') {
      const { amount, from, to } = parameters;
      
      // Validate amount
      if (amount < 0) {
        return 'Error: Amount cannot be negative';
      }
      
      // Normalize currency codes to uppercase
      const fromCurrency = from.toUpperCase();
      const toCurrency = to.toUpperCase();
      
      try {
        // Use exchangerate.host API (free, no API key required)
        const url = `https://api.exchangerate.host/convert?from=${fromCurrency}&to=${toCurrency}&amount=${amount}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          return `Error: Failed to fetch exchange rates (status ${response.status})`;
        }
        
        const data = await response.json();
        
        // Check if the API returned an error
        if (!data.success) {
          return `Error: ${data.error?.info || 'Unable to convert currency. Check currency codes.'}`;
        }
        
        const convertedAmount = data.result;
        const rate = data.info?.rate;
        
        if (convertedAmount === undefined) {
          return 'Error: Unable to get conversion result';
        }
        
        // Format the result with 2 decimal places for most currencies
        const formattedAmount = convertedAmount.toFixed(2);
        
        if (rate) {
          return `${amount} ${fromCurrency} = ${formattedAmount} ${toCurrency} (rate: ${rate.toFixed(6)})`;
        } else {
          return `${amount} ${fromCurrency} = ${formattedAmount} ${toCurrency}`;
        }
        
      } catch (error) {
        console.error('[currency] Error converting currency:', error);
        return `Error converting currency: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
