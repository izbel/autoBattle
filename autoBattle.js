function defaultFor(arg, val) {
    return typeof arg !== 'undefined' ? arg : val;
}

var mercs = ['footman', 'cleric', 'commander', 'mage', 'assassin', 'warlock'];
var XPFarmLevel = 0;
var lootFarmStep = 0;
var lootFarm = false;
var autoQuest = true;
var XPS = 0;
var lastXP = 0;
var capMobLevelAtPlayerLevel = true;
var lootFarmRarities = [MonsterRarity.BOSS, MonsterRarity.ELITE];

function efficiency() {
    return mercs.map(function (m) {
        return {
            name: m.toUpperCase(),
            efficiency: game.mercenaryManager[m + 'Price'] / parseFloat(game.mercenaryManager.getGps().replace(/,/g, '')) + game.mercenaryManager[m + 'Price'] / game.mercenaryManager.getMercenariesGps(m.toUpperCase())
        }
    }).sort(function (a, b) {
        return a.efficiency > b.efficiency
    });
}

function maxMonsterRarity(level) {
    if (level >= 30) {
        return MonsterRarity.BOSS;
    } else if (level >= 10) {
        return MonsterRarity.ELITE;
    } else {
        return MonsterRarity.RARE;
    }
}

function equipAndSellInventory() {
    game.inventory.slots.forEach(function (i, x) {
        if (i != null) {
            var newSlot = shouldEquip(i);
            if (newSlot == -1) {
                //Item isn't better than the current one, sell it
                game.inventory.sellItem(x);
            } else {
                //Item is better, equip it
                game.equipment.equipItemInSlot(i, newSlot, x);
            }
        }
    });
}

function updateMobLevels() {
    var minDamage = getEstimatedDamage();
    var monsterHealth = 0;
    var level = 1;
    //keep going up while we can one shot
    while (monsterHealth < minDamage) {
        level++;
        //calculate health of mob at new level
        monsterHealth = Sigma(level) * Math.pow(1.05, level) + 5;
    }
    level--;
    XPFarmLevel = Math.max(1, level);
    if (capMobLevelAtPlayerLevel) XPFarmLevel = Math.min(game.player.level, level);
    level = 1;
    var bossHit = ((Sigma(level) * Math.pow(1.01, level)) / 3) * 8;
    //bossHit -= Math.floor(bossHit * (game.player.calculateDamageReduction() / 100));
    while (!attackWillKill(bossHit, true) && !attackWillLoseHP(bossHit)) {
        //loop until either the boss will one shot me or I'll lose HP
        level++;
        bossHit = ((Sigma(level) * Math.pow(1.01, level)) / 3) * 8;
        //bossHit -= Math.floor(bossHit * (game.player.calculateDamageReduction() / 100));
    }
    level--;
    if (capMobLevelAtPlayerLevel) level = Math.min(game.player.level, level);
    lootFarmStep = Math.floor(level / 35);
}

function attackWillLoseHP(baseDamage) {
    var damage = Math.max(0, baseDamage - Math.floor(baseDamage * (game.player.calculateDamageReduction() / 100)));
    var healAmount = game.player.abilities.getRejuvenatingStrikesHealAmount(0) * (game.player.attackType == AttackType.DOUBLE_STRIKE ? 2 : 1);
    return damage > healAmount;
}

function attackWillKill(monsterBaseDamage, fromFull) {
    monsterDamage = defaultFor(monsterBaseDamage, game.monster.damage);
    fromFull = defaultFor(fromFull, false);
    var damage = Math.max(0, monsterDamage - Math.floor(monsterDamage * (game.player.calculateDamageReduction() / 100)));
    var healAmount = game.player.abilities.getRejuvenatingStrikesHealAmount(0) * (game.player.attackType == AttackType.DOUBLE_STRIKE ? 2 : 1);
    var playerHealthAfterHeal = Math.min(game.player.getMaxHealth(), game.player.health +  healAmount);
    return (game.monster.canAttack || fromFull) && (fromFull ? game.player.getMaxHealth() : playerHealthAfterHeal) <= damage;
}

//Function will return the slot this should be equipped in.  -1 meaning it shouldn't be equipped.
function shouldEquip(newItem) {
    var compareTo;
    var slot;
    switch (newItem.type) {
    case ItemType.HELM:
        slot = isBetterThan(game.equipment.helm(), newItem) ? 0 : -1;
        break;
    case ItemType.SHOULDERS:
        slot = isBetterThan(game.equipment.shoulders(), newItem) ? 1 : -1;
        break;
    case ItemType.CHEST:
        slot = isBetterThan(game.equipment.chest(), newItem) ? 2 : -1;
        break;
    case ItemType.LEGS:
        slot = isBetterThan(game.equipment.legs(), newItem) ? 3 : -1;
        break;
    case ItemType.WEAPON:
        slot = isBetterThan(game.equipment.weapon(), newItem) ? 4 : -1;
        break;
    case ItemType.GLOVES:
        slot = isBetterThan(game.equipment.gloves(), newItem) ? 5 : -1;
        break;
    case ItemType.BOOTS:
        slot = isBetterThan(game.equipment.boots(), newItem) ? 6 : -1;
        break;
    case ItemType.TRINKET:
        slot = isBetterThan(game.equipment.trinket1(), newItem) ? 7 : -1;
        //if it wasn't better than trinket 1 check trinket 2.
        if ((slot == -1) && isBetterThan(game.equipment.trinket2(), newItem)) {
            slot = 8;
        }
        break;
    case ItemType.OFF_HAND:
        slot = isBetterThan(game.equipment.off_hand(), newItem) ? 9 : -1;
        break;
    }

    return slot;

}

// will return true if newItem is better than oldItem, false otherwise.
function isBetterThan(oldItem, newItem) {
    //if newItem isn't passed
    if (newItem == null) return false;

    //if there's no oldItem new is automatically better
    if (oldItem == null) return true;

    //if the items aren't the same type, return false automatically
    if (oldItem.type != newItem.type) return false;

    // compare weapons and trinkets differently
    switch (oldItem.type) {
    case ItemType.WEAPON:
        return isBetterThanWeapon(oldItem, newItem);
    case ItemType.TRINKET:
        return isBetterThanTrinket(oldItem, newItem);
    default:
        return isBetterThanItem(oldItem, newItem);
    }
}

// Checks weapons to see if new is better than old and returns true if so, false otherwise
// Assumes items are same type and not null
function isBetterThanWeapon(oldWeapon, newWeapon) {
    var oldHasCrushing = oldWeapon.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []).indexOf("CRUSHING_BLOWS") > -1;
    var newHasCrushing = newWeapon.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []).indexOf("CRUSHING_BLOWS") > -1;
    var oldAvgDamage = (oldWeapon.minDamage + oldWeapon.maxDamage) / 2 + oldWeapon.damageBonus;
    var newAvgDamage = (newWeapon.minDamage + newWeapon.maxDamage) / 2 + newWeapon.damageBonus;

    //Crushing blows always overrides other considerations
    if (oldHasCrushing && !newHasCrushing) return false;
    if (newHasCrushing && !oldHasCrushing) return true;

    //Next is average damage
    if (oldAvgDamage > newAvgDamage) return false;
    if (newAvgDamage > oldAvgDamage) return true;

    //Having an effect is better than not having an effect, but may need to actually compare them later
    if (oldWeapon.effects.length > newWeapon.effects.length) return false;
    if (newWeapon.effects.length > oldWeapon.effects.length) return true;

    //From here on we're comparing stats
    return isBetterThanStats(oldWeapon, newWeapon);

}

function isBetterThanTrinket(oldTrinket, newTrinket) {
    var oldEffects = oldTrinket.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []);
    var newEffects = newTrinket.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []);

    //Swiftness is the best
    if (oldEffects.indexOf("SWIFTNESS") > -1 && newEffects.indexOf("SWIFTNESS") == -1) return false;
    if (newEffects.indexOf("SWIFTNESS") > -1 && oldEffects.indexOf("SWIFTNESS") == -1) return true;

    //Pillaging is next
    if (oldEffects.indexOf("PILLAGING") > -1 && newEffects.indexOf("PILLAGING") == -1) return false;
    if (newEffects.indexOf("PILLAGING") > -1 && oldEffects.indexOf("PILLAGING") == -1) return true;

    //Berserking is very underpowered since it doesn't multiply ignore it for now
    //if (oldEffects.indexOf("BERSERKING") > -1 && newEffects.indexOf("BERSERKING") == -1) return false;
    //if (newEffects.indexOf("BERSERKING") > -1 && oldEffects.indexOf("BERSERKING") == -1) return false;

    //Nourishment isn't really relevant so just compare on stats
    return isBetterThanStats(oldTrinket, newTrinket);

}

function isBetterThanItem(oldItem, newItem) {
    var oldEffects = oldItem.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []);
    var newEffects = newItem.effects.reduce(function (e, n) {
        return e.concat(n.type);
    }, []);

    //Need to have something that checks rend vs frost vs flame vs barrier imbued eventually
    //but for now just ranked as flame, frost, rend, barrier
    //flame imbued is the best
    if (oldEffects.indexOf("FLAME_IMBUED") > -1 && newEffects.indexOf("FLAME_IMBUED") == -1) return false;
    if (newEffects.indexOf("FLAME_IMBUED") > -1 && oldEffects.indexOf("FLAME_IMBUED") == -1) return true;

    //Frost shards is next
    if (oldEffects.indexOf("FROST_SHARDS") > -1 && newEffects.indexOf("FROST_SHARDS") == -1) return false;
    if (newEffects.indexOf("FROST_SHARDS") > -1 && oldEffects.indexOf("FROST_SHARDS") == -1) return true;

    //Wounding is next
    if (oldEffects.indexOf("WOUNDING") > -1 && newEffects.indexOf("WOUNDING") == -1) return false;
    if (newEffects.indexOf("WOUNDING") > -1 && oldEffects.indexOf("WOUNDING") == -1) return true;

    //Barrier is next
    if (oldEffects.indexOf("BARRIER") > -1 && newEffects.indexOf("BARRIER") == -1) return false;
    if (newEffects.indexOf("BARRIER") > -1 && oldEffects.indexOf("BARRIER") == -1) return true;

    //Curing isn't really relevant so just compare stats
    return isBetterThanStats(oldItem, newItem);

}

// Checks stats on item to see if new is better than old and returns true if so, false otherwise
// Assumes items are same type and not null
function isBetterThanStats(oldItem, newItem) {
    var critChange = newItem.critChance - oldItem.critChance;
    critChange = critChange * ((game.player.powerShards / 100) + 1);

    //we're losing crit and taking ourselves below 100 old is better
    if ((critChange < 0) && (game.player.getCritChance() + critChange < 100)) return false;

    //we're under 100 and we're gaining crit
    if ((critChange > 0) && (game.player.getCritChance() < 100)) return true;

    //otherwise, compare gold and XP gain
    var goldAndXPChange = newItem.goldGain + newItem.experienceGain - (oldItem.goldGain + oldItem.experienceGain);

    if (goldAndXPChange > 0) return true;
    if (goldAndXPChange < 0) return false;

    //next is item rarity
    if (oldItem.itemRarity > newItem.itemRarity) return false;
    if (oldItem.itemRarity < newItem.itemRarity) return true;

    //then damage modifiers
    if ((oldItem.strength + oldItem.agility) > (newItem.strength + newItem.agility)) return false;
    if ((oldItem.strength + oldItem.agility) < (newItem.strength + newItem.agility)) return true;

    //if we're equal to here just take the higher ilevel
    if (newItem.level > oldItem.level) return true;

    return false;
}


//this is used for XP farming calculations, assumed to be fighting common mobs
//debuffs from abilities are not calculated because we're assuming one shotting monsters, so only base damage matters
function getEstimatedDamage(mobLevel, assumeCrit, useMinimum) {
    mobLevel = defaultFor(mobLevel, game.player.level);
    assumeCrit = defaultFor(assumeCrit, true);
    useMinimum = defaultFor(useMinimum, false);

    var damageDone = 0;

    var attacks = 0;
    var averageDamage = 0;
    if (useMinimum) {
        averageDamage = game.player.getMinDamage();
    } else {
        averageDamage = (game.player.getMinDamage() + game.player.getMaxDamage()) / 2;
    }

    // If the player is using power strike, multiply the damage
    if (game.player.attackType == AttackType.POWER_STRIKE) {
        averageDamage *= 1.5;
    }

    //average in crits
    averageDamage *= (game.player.getCritDamage() / 100) * (assumeCrit ? 1 : Math.min(100, (game.player.getCritChance() / 100)));


    // If the player has any crushing blows effects then deal the damage from those effects
    // Not useful for xp farming since it's such a rare effect
    //var crushingBlowsEffects = game.player.getEffectsOfType(EffectType.CRUSHING_BLOWS);
    //var crushingBlowsDamage = 0;
    //if (crushingBlowsEffects.length > 0) {
    //  for (var y = 0; y < crushingBlowsEffects.length; y++) {
    //    crushingBlowsDamage += crushingBlowsEffects[y].value;
    //  }
    //  if (crushingBlowsDamage > 0) {
    //    damageDone += (crushingBlowsDamage / 100) * game.calculateMonsterHealth(mobLevel, "COMMON");
    //  }
    //}

    var abilityDamage = 0;

    abilityDamage = game.player.abilities.getIceBladeDamage(0) + game.player.abilities.getFireBladeDamage(0);
    abilityDamage *= (game.player.getCritDamage() / 100) * (assumeCrit ? 1 : Math.min(100, (game.player.getCritChance() / 100)));

    attacks = 1;
    if (game.player.attackType == AttackType.DOUBLE_STRIKE) {
        attacks++;
    }

    //swiftness is a simple multiplier just like attack amount
    var swiftnessEffects = game.player.getEffectsOfType(EffectType.SWIFTNESS);
    attacks *= (swiftnessEffects.length + 1);

    damageDone += averageDamage;
    damageDone += abilityDamage;

    damageDone *= attacks;

    var berserkingDamage = game.player.getEffectsOfType(EffectType.BERSERKING).reduce(function (e, b) {
        return e + (b.value * b.chance / 100);
    }, 0);
    damageDone += berserkingDamage * attacks;

    return damageDone;
}

function hopBattle() {
    game.leaveBattle();
    game.enterBattle();
}

function attack() {
    if (!attackWillKill()) {
        attackButtonClick();
    }
}

//Automatically processes an attack or hop for the first quest in line that isn't a merc quest
function runQuest() {
    var quest = game.questsManager.quests.filter(function(x) { return x.type == QuestType.KILL || x.type == QuestType.ENDLESS_BOSSKILL; })[0];
    
    switch (quest.type) {
        case QuestType.KILL:
            //Kill X of Level Y type mobs  Best to use only commons for speed
            processMobForQuest(quest.typeId, MonsterRarity.COMMON);
            break;
        case QuestType.ENDLESS_BOSSKILL:
            //Kill 1 boss of current player level
            processMobForQuest(game.player.level, MonsterRarity.BOSS);
            break;
    }
}

function processMobForQuest(level, rarity) {
    if (game.battleLevel != level) { 
        game.battleLevel = level;
        hopBattle();
    }
    if (game.monster.rarity != rarity) {
        hopBattle();   
    } else {
        attack();
    }
}

var autoInventory = setInterval(function () {
    equipAndSellInventory();
}, 250);

var autoFight = setInterval(function () {
    if (game.inBattle) {
        //ENDLESS_BOSSKILL is from Endless Improvement, might as well check for them
        if (autoQuest && game.questsManager.quests.filter(function(x) { return x.type == QuestType.KILL || x.type == QuestType.ENDLESS_BOSSKILL; }).length > 0) {
            runQuest();
        } else if (lootFarm) {
            game.battleLevel = lootFarmStep * 35 + 1;
            if (game.monster.level != game.battleLevel) { hopBattle(); }
            if ((lootFarmRarities.indexOf(game.monster.rarity) > -1) || game.monster.rarity == maxMonsterRarity(game.battleLevel)) {
                //One of the ones we're looking for
                attack();
            } else {
                hopBattle();
            }
        } else {
            game.battleLevel = XPFarmLevel;
            if (game.monster.rarity != MonsterRarity.COMMON) {
                hopBattle();
            } else {
                attack();
            }
        }
    }
}, 0);

var autoMisc = setInterval(function () {
    autoLevel();
    autoBuy();
    calculateXP();
    updateMobLevels();
}, 5000);

function autoBuy() {
    var bestPurchase = efficiency()[0];
    while (game.player.gold > game.mercenaryManager[bestPurchase.name.toLowerCase() + "Price"]) {
        game.mercenaryManager.purchaseMercenary(bestPurchase.name);
        bestPurchase = efficiency()[0];
    }
}

function autoLevel() {
    while (game.player.skillPoints > 0) {
        //level up is available
        if ((game.player.skillPointsSpent + 2) % 5 == 0) {
            //Level up type is selecting an ability
            abilityLevelUp();
        } else {
            //Stat level up type
            statLevelUp();
        }
    }
}

function abilityLevelUp() {
    //In case the user has it open, don't want to allow them to click it after a level up
    $("#abilityUpgradesWindow").hide();
    
    var ability = getBestAbilityName();
    
    console.log('Leveling to level ' + (game.player.skillPointsSpent + 1) + ' with ability ' + ability);
    
    game.player.increaseAbilityPower(ability);
    
}

function getBestAbilityName() {
    var ability;
    
    //Rejuv scales crazy with level and damage, I'll go with 1 stack every 25 player levels for now, capped at 10
    //That should mean selecting it once every 5 ability level ups for the first 250 levels
    if ((game.player.abilities.baseRejuvenatingStrikesLevel < Math.floor(game.player.level/25)) && game.player.abilities.baseRejuvenatingStrikesLevel <10) {
        ability = AbilityName.REJUVENATING_STRIKES;
    } else {
        //Right now we're just going on lowest level, theoretically this should have some logic in it later
        if (game.player.abilities.baseRendLevel < game.player.abilities.baseIceBladeLevel) {
            ability = AbilityName.FIRE_BLADE;
            if (game.player.abilities.baseRendLevel < game.player.abilities.baseFireBladeLevel) ability = AbilityName.REND;
        } else {
            ability = AbilityName.FIRE_BLADE;
            if (game.player.abilities.baseIceBladeLevel < game.player.abilities.baseFireBladeLevel) ability = AbilityName.ICE_BLADE;
        }
    }
    
    return ability;
}

function statLevelUp() {
    
    var index = getIndexOfBestUpgrade();

    console.log('Leveling to level ' + (game.player.skillPointsSpent + 1) + ' with stat ' + game.statUpgradesManager.upgrades[0][index].type);

    //The function does the button click, it's annoying and I've asked the dev to refactor it, but for now I have to pass a button to it
    statUpgradeButtonClick(document.getElementById('statUpgradeButton1'),index+1);
    
}

function getIndexOfBestUpgrade() {
    var upgradeNames = game.statUpgradesManager.upgrades[0].reduce(function (l, u) {
        return l.concat(u.type);
    }, []);
    
    var index = upgradeNames.indexOf(StatUpgradeType.ITEM_RARITY);
    if ((getItemRarityWithoutItems() <= 9900) && index > -1) return index;
    
    index = upgradeNames.indexOf(StatUpgradeType.GOLD_GAIN);
    if (index>-1) return index;
    
    index = upgradeNames.indexOf(StatUpgradeType.EXPERIENCE_GAIN);
    if (index>-1) return index;
    
    //Strength and damage first
    index = upgradeNames.indexOf(StatUpgradeType.STRENGTH);
    var index2 = upgradeNames.indexOf(StatUpgradeType.DAMAGE);
    
    if (index > -1) {
        if (index2 > -1) {
            //has both
            //Strength is converted to bonus damage and also gains HP so give it a 5% boost
            //Yes I just made that up
            if ((game.statUpgradesManager.upgrades[0][index].amount * 1.05) > game.statUpgradesManager.upgrades[0][index2].amount) {
                return index;
            } else {
                return index2;
            }
        } else {
            //only has strength
            return index;
        }
    } else if (index2 > -1) {
        //only has Damage
        return index2;
    }
    
    //Now crit and agi
    index = upgradeNames.indexOf(StatUpgradeType.AGILITY);
    index2 = upgradeNames.indexOf(StatUpgradeType.CRIT_DAMAGE);
    
        if (index > -1) {
        if (index2 > -1) {
            //has both
            //Agi is converted to crit damage at the rate of .2 * powershards plus gains a tiny but from evasion, but who cares
            if ((game.statUpgradesManager.upgrades[0][index].amount * (((game.player.powerShards / 100) + 1)*.2)) > game.statUpgradesManager.upgrades[0][index2].amount) {
                return index;
            } else {
                return index2;
            }
        } else {
            //only has strength
            return index;
        }
    } else if (index2 > -1) {
        //only has Damage
        return index2;
    }
    
    
    //if we haven't returned by now, just pick the first one, they all suck anyway
    return 0;
}


function getItemRarityWithoutItems() {
    return (game.player.baseStats.itemRarity + game.player.chosenLevelUpBonuses.itemRarity) * ((game.player.powerShards / 100) + 1);
}


function calculateXP() {
    var earnedXP = game.stats.experienceEarned - lastXP;
    lastXP = game.stats.experienceEarned;
    XPS = earnedXP / 5;
}
