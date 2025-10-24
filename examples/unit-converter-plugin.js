// Unit converter plugin for the IRC bot
// Converts between common units (temperature, length, weight, volume)

const plugin = {
  name: 'unit-converter',
  description: 'Convert between common units of measurement including temperature (Celsius/Fahrenheit/Kelvin), length (meters/feet/miles/km), weight (kg/lbs/oz), and volume (liters/gallons).',
  tools: [
    {
      name: 'convert_unit',
      description: 'Convert a value from one unit to another',
      parameters: {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'The numeric value to convert',
          },
          from_unit: {
            type: 'string',
            description: 'The source unit (e.g., celsius, fahrenheit, kelvin, meters, feet, miles, km, kg, lbs, oz, liters, gallons)',
          },
          to_unit: {
            type: 'string',
            description: 'The target unit to convert to',
          },
        },
        required: ['value', 'from_unit', 'to_unit'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'convert_unit') {
      const { value, from_unit, to_unit } = parameters;
      
      const from = from_unit.toLowerCase();
      const to = to_unit.toLowerCase();
      
      try {
        let result;
        
        // Temperature conversions
        if (['celsius', 'fahrenheit', 'kelvin', 'c', 'f', 'k'].includes(from) &&
            ['celsius', 'fahrenheit', 'kelvin', 'c', 'f', 'k'].includes(to)) {
          result = convertTemperature(value, from, to);
        }
        // Length conversions
        else if (['meters', 'feet', 'miles', 'kilometers', 'km', 'm', 'ft', 'mi'].includes(from) &&
                 ['meters', 'feet', 'miles', 'kilometers', 'km', 'm', 'ft', 'mi'].includes(to)) {
          result = convertLength(value, from, to);
        }
        // Weight conversions
        else if (['kilograms', 'pounds', 'ounces', 'kg', 'lbs', 'oz', 'grams', 'g'].includes(from) &&
                 ['kilograms', 'pounds', 'ounces', 'kg', 'lbs', 'oz', 'grams', 'g'].includes(to)) {
          result = convertWeight(value, from, to);
        }
        // Volume conversions
        else if (['liters', 'gallons', 'milliliters', 'l', 'gal', 'ml'].includes(from) &&
                 ['liters', 'gallons', 'milliliters', 'l', 'gal', 'ml'].includes(to)) {
          result = convertVolume(value, from, to);
        }
        else {
          return `Error: Cannot convert from ${from_unit} to ${to_unit}. Unsupported unit or incompatible unit types.`;
        }
        
        // Format the result
        const formattedResult = Number(result.toFixed(4));
        return `${value} ${from_unit} = ${formattedResult} ${to_unit}`;
        
      } catch (error) {
        console.error('[unit-converter] Error converting units:', error);
        return `Error converting units: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

// Temperature conversion helper
function convertTemperature(value, from, to) {
  // Normalize units
  const fromUnit = from === 'c' ? 'celsius' : from === 'f' ? 'fahrenheit' : from === 'k' ? 'kelvin' : from;
  const toUnit = to === 'c' ? 'celsius' : to === 'f' ? 'fahrenheit' : to === 'k' ? 'kelvin' : to;
  
  if (fromUnit === toUnit) return value;
  
  // Convert to Celsius first
  let celsius;
  if (fromUnit === 'celsius') celsius = value;
  else if (fromUnit === 'fahrenheit') celsius = (value - 32) * 5/9;
  else if (fromUnit === 'kelvin') celsius = value - 273.15;
  
  // Convert from Celsius to target
  if (toUnit === 'celsius') return celsius;
  if (toUnit === 'fahrenheit') return celsius * 9/5 + 32;
  if (toUnit === 'kelvin') return celsius + 273.15;
  
  throw new Error(`Unknown temperature units: ${from} to ${to}`);
}

// Length conversion helper
function convertLength(value, from, to) {
  // Normalize units
  const fromUnit = from === 'm' ? 'meters' : from === 'ft' ? 'feet' : from === 'km' ? 'kilometers' : from === 'mi' ? 'miles' : from;
  const toUnit = to === 'm' ? 'meters' : to === 'ft' ? 'feet' : to === 'km' ? 'kilometers' : to === 'mi' ? 'miles' : to;
  
  if (fromUnit === toUnit) return value;
  
  // Convert to meters first
  let meters;
  if (fromUnit === 'meters') meters = value;
  else if (fromUnit === 'feet') meters = value * 0.3048;
  else if (fromUnit === 'kilometers') meters = value * 1000;
  else if (fromUnit === 'miles') meters = value * 1609.34;
  
  // Convert from meters to target
  if (toUnit === 'meters') return meters;
  if (toUnit === 'feet') return meters / 0.3048;
  if (toUnit === 'kilometers') return meters / 1000;
  if (toUnit === 'miles') return meters / 1609.34;
  
  throw new Error(`Unknown length units: ${from} to ${to}`);
}

// Weight conversion helper
function convertWeight(value, from, to) {
  // Normalize units
  const fromUnit = from === 'kg' ? 'kilograms' : from === 'lbs' ? 'pounds' : from === 'oz' ? 'ounces' : from === 'g' ? 'grams' : from;
  const toUnit = to === 'kg' ? 'kilograms' : to === 'lbs' ? 'pounds' : to === 'oz' ? 'ounces' : to === 'g' ? 'grams' : to;
  
  if (fromUnit === toUnit) return value;
  
  // Convert to kilograms first
  let kg;
  if (fromUnit === 'kilograms') kg = value;
  else if (fromUnit === 'grams') kg = value / 1000;
  else if (fromUnit === 'pounds') kg = value * 0.453592;
  else if (fromUnit === 'ounces') kg = value * 0.0283495;
  
  // Convert from kilograms to target
  if (toUnit === 'kilograms') return kg;
  if (toUnit === 'grams') return kg * 1000;
  if (toUnit === 'pounds') return kg / 0.453592;
  if (toUnit === 'ounces') return kg / 0.0283495;
  
  throw new Error(`Unknown weight units: ${from} to ${to}`);
}

// Volume conversion helper
function convertVolume(value, from, to) {
  // Normalize units
  const fromUnit = from === 'l' ? 'liters' : from === 'gal' ? 'gallons' : from === 'ml' ? 'milliliters' : from;
  const toUnit = to === 'l' ? 'liters' : to === 'gal' ? 'gallons' : to === 'ml' ? 'milliliters' : to;
  
  if (fromUnit === toUnit) return value;
  
  // Convert to liters first
  let liters;
  if (fromUnit === 'liters') liters = value;
  else if (fromUnit === 'milliliters') liters = value / 1000;
  else if (fromUnit === 'gallons') liters = value * 3.78541;
  
  // Convert from liters to target
  if (toUnit === 'liters') return liters;
  if (toUnit === 'milliliters') return liters * 1000;
  if (toUnit === 'gallons') return liters / 3.78541;
  
  throw new Error(`Unknown volume units: ${from} to ${to}`);
}

module.exports = plugin;
