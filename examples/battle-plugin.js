// Battle plugin for the IRC bot
// Generate two random characters and simulate a 3-round combat encounter

const crypto = require('crypto');

const plugin = {
  name: 'battle',
  description: 'Generate two random fantasy characters and simulate a turn-based combat encounter. Use when asked to simulate a battle or fight; characters derived from context_words parameter (e.g., "python, javascript" → "Champion Python" vs "Knight Javascript"); falls back to generic fantasy names; 3-round combat with streaming output.',
  tools: [
    {
      name: 'start_battle',
      description: 'Generate two random characters and simulate a 3-round combat encounter with turn-based attacks. Each character has 100 HP and deals 10-39 damage per attack. Victory by knockout or highest remaining HP after 3 rounds.',
      parameters: {
        type: 'object',
        properties: {
          context_words: {
            type: 'string',
            description: 'Comma-separated words from conversation context to use as character names (e.g., "python, javascript"). If not provided, generic fantasy names are used.',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'start_battle') {
      try {
        // Pool of 18 legendary weapons
        const weapons = [
          'Legendary Sword of Flames',
          'Mystic Staff of Thunder',
          'Enchanted Arrows of Light',
          'Ancient Warhammer of Stone',
          'Celestial Blade of Stars',
          'Shadow Dagger of Night',
          'Dragon Fang Spear',
          'Phoenix Bow of Rebirth',
          'Frost Axe of Winter',
          'Lightning Katana',
          'Ethereal Scythe',
          'Titan\'s Mace',
          'Serpent Whip',
          'Crystal Staff of Wisdom',
          'Demon Slayer Greatsword',
          'Holy Lance of Justice',
          'Cursed Blade of Doom',
          'Arcane Wand of Power',
        ];

        // Generic fantasy titles and names for fallback
        const titles = [
          'Champion', 'Knight', 'Warrior', 'Mage', 'Paladin',
          'Rogue', 'Berserker', 'Archer', 'Sorcerer', 'Monk',
        ];

        const genericNames = [
          'Dragonheart', 'Stormwind', 'Shadowblade', 'Ironforge',
          'Moonwhisper', 'Sunstrider', 'Frostborn', 'Firewalker',
          'Earthshaker', 'Windrunner',
        ];

        // Helper function to create character name
        const createCharacterName = (name) => {
          const title = titles[crypto.randomInt(0, titles.length)];
          return `${title} ${name}`;
        };

        // Helper function to capitalize first letter
        const capitalizeFirst = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

        // Parse context words or use generic names
        let char1Name, char2Name;
        
        if (parameters.context_words && parameters.context_words.trim()) {
          // Split and clean context words
          const words = parameters.context_words
            .split(',')
            .map(w => w.trim())
            .filter(w => w.length > 0);
          
          if (words.length >= 2) {
            // Use first two words from context
            char1Name = createCharacterName(capitalizeFirst(words[0]));
            char2Name = createCharacterName(capitalizeFirst(words[1]));
          } else if (words.length === 1) {
            // One word from context, one generic
            const genericName = genericNames[crypto.randomInt(0, genericNames.length)];
            char1Name = createCharacterName(capitalizeFirst(words[0]));
            char2Name = createCharacterName(genericName);
          } else {
            // No valid words, use generic names
            const name1 = genericNames[crypto.randomInt(0, genericNames.length)];
            const name2 = genericNames[crypto.randomInt(0, genericNames.length)];
            char1Name = createCharacterName(name1);
            char2Name = createCharacterName(name2);
          }
        } else {
          // No context provided, use generic fantasy names
          const name1 = genericNames[crypto.randomInt(0, genericNames.length)];
          const name2 = genericNames[crypto.randomInt(0, genericNames.length)];
          char1Name = createCharacterName(name1);
          char2Name = createCharacterName(name2);
        }

        // Assign random weapons
        const weapon1 = weapons[crypto.randomInt(0, weapons.length)];
        const weapon2 = weapons[crypto.randomInt(0, weapons.length)];

        // Initialize characters
        const char1 = {
          name: char1Name,
          weapon: weapon1,
          hp: 100,
          maxHp: 100,
        };

        const char2 = {
          name: char2Name,
          weapon: weapon2,
          hp: 100,
          maxHp: 100,
        };

        // Build battle output
        let output = '';
        output += '⚔️  BATTLE COMMENCES! ⚔️\n';
        output += '═'.repeat(50) + '\n';
        output += `${char1.name} wielding ${char1.weapon}\n`;
        output += `    VS\n`;
        output += `${char2.name} wielding ${char2.weapon}\n`;
        output += '═'.repeat(50) + '\n\n';

        // Combat simulation - 3 rounds maximum
        let round = 0;
        const maxRounds = 3;
        
        while (round < maxRounds && char1.hp > 0 && char2.hp > 0) {
          round++;
          output += `--- Round ${round} ---\n`;

          // Character 1 attacks Character 2
          const damage1 = crypto.randomInt(10, 40); // 10-39 damage
          char2.hp = Math.max(0, char2.hp - damage1);
          output += `${char1.name} attacks with ${char1.weapon}!\n`;
          output += `  → Deals ${damage1} damage! ${char2.name} HP: ${char2.hp}/${char2.maxHp}\n`;

          // Check if char2 is knocked out
          if (char2.hp <= 0) {
            output += `\n💀 ${char2.name} has been defeated!\n`;
            break;
          }

          // Character 2 attacks Character 1
          const damage2 = crypto.randomInt(10, 40); // 10-39 damage
          char1.hp = Math.max(0, char1.hp - damage2);
          output += `${char2.name} attacks with ${char2.weapon}!\n`;
          output += `  → Deals ${damage2} damage! ${char1.name} HP: ${char1.hp}/${char1.maxHp}\n`;

          // Check if char1 is knocked out
          if (char1.hp <= 0) {
            output += `\n💀 ${char1.name} has been defeated!\n`;
            break;
          }

          output += '\n';
        }

        // Determine winner
        output += '═'.repeat(50) + '\n';
        output += '🏆 BATTLE RESULTS 🏆\n';
        output += '═'.repeat(50) + '\n';

        if (char1.hp > char2.hp) {
          output += `WINNER: ${char1.name} (${char1.hp}/${char1.maxHp} HP remaining)\n`;
          output += `DEFEATED: ${char2.name} (${char2.hp}/${char2.maxHp} HP remaining)\n`;
        } else if (char2.hp > char1.hp) {
          output += `WINNER: ${char2.name} (${char2.hp}/${char2.maxHp} HP remaining)\n`;
          output += `DEFEATED: ${char1.name} (${char1.hp}/${char1.maxHp} HP remaining)\n`;
        } else {
          output += `DRAW! Both fighters have ${char1.hp}/${char1.maxHp} HP remaining!\n`;
        }

        return output;

      } catch (error) {
        console.error('[battle] Error simulating battle:', error);
        return `Error simulating battle: ${error.message}`;
      }
    }

    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
