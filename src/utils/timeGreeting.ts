export interface TimeGreetingInfo {
  salutation: 'Good morning' | 'Good afternoon' | 'Good evening' | 'Good night';
  emoji: string;
  periodLabel: string;
  subTitle: string;
  fieldGuidance: string;
  clockTime: string;
}

/**
 * Returns a warm, dynamic time-of-day greeting based on the user's local clock:
 * - 05:00 - 11:59: Good morning (🌅)
 * - 12:00 - 16:59: Good afternoon (☀️)
 * - 17:00 - 21:59: Good evening (🌇)
 * - 22:00 - 04:59: Good night (🌙)
 */
export function getCurrentGreeting(date = new Date()): TimeGreetingInfo {
  const hour = date.getHours();
  const clockTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (hour >= 5 && hour < 12) {
    return {
      salutation: 'Good morning',
      emoji: '🌅',
      periodLabel: 'DAWN & MORNING CANOPY',
      subTitle: 'Crisp morning dew on woodland trails · Prime time for canopy birdsong & fresh leaf gathering',
      fieldGuidance: 'The early morning light filters gently through the upper boughs. Optimal time for collecting fallen foliage with intact moisture and spotting early songbirds.',
      clockTime,
    };
  }

  if (hour >= 12 && hour < 17) {
    return {
      salutation: 'Good afternoon',
      emoji: '☀️',
      periodLabel: 'HIGH SUN RECONNAISSANCE',
      subTitle: 'Peak overhead sunlight · Rich contrast on forest ground & tree bark',
      fieldGuidance: 'Direct ambient illumination highlights deep crevices in tree bark, smooth river pebbles, and vibrant moss textures. Ideal conditions for outdoor ground crafting.',
      clockTime,
    };
  }

  if (hour >= 17 && hour < 22) {
    return {
      salutation: 'Good evening',
      emoji: '🌇',
      periodLabel: 'GOLDEN HOUR EXPEDITION',
      subTitle: 'Warm amber glow across the canopy · Crepuscular forest wildlife stirring',
      fieldGuidance: 'Soft golden hour rays cast long silhouettes across the path. Crepuscular wildlife begins moving through the brush. Listen for dusk calls in your earphones.',
      clockTime,
    };
  }

  return {
    salutation: 'Good night',
    emoji: '🌙',
    periodLabel: 'NOCTURNAL CANOPY & STARLIGHT',
    subTitle: 'Quiet starlit skies · Bio-acoustic immersion for night sounds',
    fieldGuidance: 'The woodland enters its tranquil night phase. Switch on earphones, listen for night crickets, owls, and rustling nocturnal flora beneath the starlit sky.',
    clockTime,
  };
}
