// Battle plugin for the IRC bot
// Creates two random characters and has them battle over 3 rounds

const plugin = {
  name: 'battle',
  description: 'Create an epic battle between two randomly generated characters. Characters are given names based on the current conversation context and random weapons. The battle plays out over 3 rounds with commentary.',
  tools: [
    {
      name: 'start_battle',
      description: 'Start a 3-round battle between two randomly generated characters. Characters will have names inspired by the current conversation and random weapons. Use this when users want to see a battle, fight, duel, or combat.',
      parameters: {
        type: 'object',
        properties: {
          context_words: {
            type: 'string',
            description: 'Recent words or topics from the conversation to inspire character names (comma-separated). If no context provided, generic names will be used.',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'start_battle') {
      try {
        // Parse context words if provided
        const contextWords = parameters.context_words 
          ? parameters.context_words.split(',').map(w => w.trim()).filter(w => w.length > 0)
          : [];
        
        // Generate character names based on context
        const character1 = generateCharacterName(contextWords, 0);
        const character2 = generateCharacterName(contextWords, 1);
        
        // Assign random weapons
        const weapon1 = getRandomWeapon();
        const weapon2 = getRandomWeapon();
        
        // Initialize health
        let health1 = 100;
        let health2 = 100;
        
        // Build battle narrative
        let battleLog = [];
        
        // Introduction
        battleLog.push('⚔️  BATTLE ROYALE ⚔️');
        battleLog.push(`${character1} wielding ${weapon1} VS ${character2} wielding ${weapon2}!`);
        battleLog.push('');
        
        // Fight for 3 rounds
        for (let round = 1; round <= 3; round++) {
          battleLog.push(`=== ROUND ${round} ===`);
          
          // Character 1 attacks
          const damage1 = Math.floor(Math.random() * 30) + 10;
          health2 -= damage1;
          battleLog.push(`${character1} attacks with ${weapon1} for ${damage1} damage!`);
          battleLog.push(`${character2}: ${Math.max(0, health2)} HP remaining`);
          
          // Check if character 2 is defeated
          if (health2 <= 0) {
            battleLog.push('');
            battleLog.push(`💀 ${character2} has been defeated!`);
            battleLog.push(`🏆 ${character1} WINS!`);
            break;
          }
          
          // Character 2 counterattacks
          const damage2 = Math.floor(Math.random() * 30) + 10;
          health1 -= damage2;
          battleLog.push(`${character2} counterattacks with ${weapon2} for ${damage2} damage!`);
          battleLog.push(`${character1}: ${Math.max(0, health1)} HP remaining`);
          
          // Check if character 1 is defeated
          if (health1 <= 0) {
            battleLog.push('');
            battleLog.push(`💀 ${character1} has been defeated!`);
            battleLog.push(`🏆 ${character2} WINS!`);
            break;
          }
          
          battleLog.push('');
        }
        
        // If both still standing after 3 rounds, determine winner by remaining health
        if (health1 > 0 && health2 > 0) {
          if (health1 > health2) {
            battleLog.push(`⏰ TIME'S UP! ${character1} wins with ${health1} HP remaining!`);
          } else if (health2 > health1) {
            battleLog.push(`⏰ TIME'S UP! ${character2} wins with ${health2} HP remaining!`);
          } else {
            battleLog.push(`🤝 IT'S A TIE! Both warriors remain standing with ${health1} HP!`);
          }
        }
        
        return battleLog.join('\n');
        
      } catch (error) {
        console.error('[battle] Error running battle:', error);
        return `Error: Unable to start battle. ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

/**
 * Generate a character name based on context words
 */
function generateCharacterName(contextWords, index) {
  const prefixes = [
    'Sir', 'Lord', 'Lady', 'Captain', 'Commander', 'The Mighty',
    'The Fearless', 'The Legendary', 'The Swift', 'The Brave',
    'Master', 'Champion', 'Warrior', 'Knight', 'Paladin'
  ];
  
  const suffixes = [
    'the Bold', 'the Fierce', 'the Unstoppable', 'the Destroyer',
    'the Conqueror', 'the Valiant', 'the Magnificent', 'the Terrible',
    'the Relentless', 'the Indomitable', 'of Doom', 'of Glory'
  ];
  
  // If we have context words, use them to create character names
  if (contextWords.length > 0) {
    const contextWord = contextWords[Math.min(index, contextWords.length - 1)];
    // Capitalize first letter
    const capitalizedWord = contextWord.charAt(0).toUpperCase() + contextWord.slice(1);
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    
    // 50% chance to use prefix, 50% chance to use suffix
    if (Math.random() < 0.5) {
      return `${prefix} ${capitalizedWord}`;
    } else {
      return `${capitalizedWord} ${suffix}`;
    }
  }
  
  // Default generic names if no context
  const genericNames = [
    'Sir Lancelot', 'The Crimson Blade', 'Shadow Warrior', 'Thunder Knight',
    'Storm Champion', 'Iron Fist', 'Dragon Slayer', 'Phoenix Rider',
    'Frost Guard', 'Lightning Strike', 'Stone Crusher', 'Wind Runner',
    'Flame Bearer', 'Night Stalker', 'Steel Heart', 'Battle Master'
  ];
  
  return genericNames[Math.floor(Math.random() * genericNames.length)];
}

/**
 * Get a random weapon
 */
function getRandomWeapon() {
  const weapons = [
    'a legendary sword',
    'a mystic staff',
    'dual daggers',
    'a mighty warhammer',
    'a razor-sharp axe',
    'enchanted arrows',
    'a blazing spear',
    'thunderous gauntlets',
    'a cursed blade',
    'a holy mace',
    'shadow claws',
    'a crystal bow',
    'a flaming whip',
    'frostbite knuckles',
    'a poisoned rapier',
    'an ancient halberd',
    'lightning chakrams',
    'a spectral scythe'
  ];
  
  return weapons[Math.floor(Math.random() * weapons.length)];
}

module.exports = plugin;
