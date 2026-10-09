import type { AiProfileConfig, GameConfig } from '../config/schema';
import type { AiProfileId } from '../model/ids';

/** Parameters of a profile, from config.ai.profiles. */
export function profileOf(config: GameConfig, profileId: AiProfileId | undefined): AiProfileConfig {
  const profile = profileId ? config.ai.profiles[profileId] : undefined;
  if (!profile)
    throw new Error(`AI profile ${profileId ?? '(none)'} missing from config.ai.profiles`);
  return profile;
}
