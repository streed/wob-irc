// Calculator plugin for the IRC bot
// Evaluates mathematical expressions safely

const plugin = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions and perform calculations. Supports basic arithmetic, trigonometry, logarithms, and common math functions.',
  tools: [
    {
      name: 'calculate',
      description: 'Evaluate a mathematical expression and return the result. Supports +, -, *, /, %, **, parentheses, and functions like sqrt, sin, cos, tan, log, abs, floor, ceil, round, min, max, pow.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(3.14159/2)")',
          },
        },
        required: ['expression'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'calculate') {
      const expression = parameters.expression.trim();
      
      // Validate expression - only allow safe math characters
      const safePattern = /^[0-9+\-*/%().,\s]+$/;
      const functionPattern = /\b(sqrt|sin|cos|tan|log|ln|abs|floor|ceil|round|min|max|pow|exp|PI|E)\b/gi;
      
      // Check if expression contains only safe characters and allowed functions
      const expressionWithoutFunctions = expression.replace(functionPattern, '');
      if (!safePattern.test(expressionWithoutFunctions)) {
        return 'Error: Expression contains invalid characters. Only numbers, operators (+, -, *, /, %, **), parentheses, and math functions are allowed.';
      }
      
      // Prevent very long expressions (DoS protection)
      if (expression.length > 500) {
        return 'Error: Expression is too long (max 500 characters)';
      }
      
      try {
        // Create a safe math context
        const mathFunctions = {
          sqrt: Math.sqrt,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          log: Math.log10,
          ln: Math.log,
          abs: Math.abs,
          floor: Math.floor,
          ceil: Math.ceil,
          round: Math.round,
          min: Math.min,
          max: Math.max,
          pow: Math.pow,
          exp: Math.exp,
          PI: Math.PI,
          E: Math.E,
        };
        
        // Replace function names with their implementations
        let safeExpression = expression;
        for (const [name, func] of Object.entries(mathFunctions)) {
          const regex = new RegExp(`\\b${name}\\b`, 'gi');
          if (typeof func === 'number') {
            safeExpression = safeExpression.replace(regex, func.toString());
          } else {
            safeExpression = safeExpression.replace(regex, `Math.${name}`);
          }
        }
        
        // Use Function constructor to evaluate (safer than eval)
        const result = new Function('Math', `'use strict'; return (${safeExpression})`)(Math);
        
        // Check if result is valid
        if (typeof result !== 'number' || !isFinite(result)) {
          return 'Error: Calculation resulted in an invalid number';
        }
        
        // Format result - use scientific notation for very large/small numbers
        let formattedResult;
        if (Math.abs(result) > 1e10 || (Math.abs(result) < 1e-6 && result !== 0)) {
          formattedResult = result.toExponential(6);
        } else {
          // Round to 10 decimal places to avoid floating point issues
          formattedResult = Math.round(result * 1e10) / 1e10;
        }
        
        return `${expression} = ${formattedResult}`;
        
      } catch (error) {
        console.error('[calculator] Error evaluating expression:', error);
        return `Error: Unable to evaluate expression. Check syntax and try again.`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
