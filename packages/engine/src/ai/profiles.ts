import type { AiProfileConfig, GameConfig } from '../config/schema';
import type { AiProfileId, SectorId } from '../model/ids';

/**
 * Parameters of a profile, from config.ai.profiles, with the overrides of
 * the company's sector (config.ai.sectorProfiles) on top.
 */
export function profileOf(
  config: GameConfig,
  profileId: AiProfileId | undefined,
  sector?: SectorId | 'holding',
): AiProfileConfig {
  const profile = profileId ? config.ai.profiles[profileId] : undefined;
  if (!profile)
    throw new Error(`AI profile ${profileId ?? '(none)'} missing from config.ai.profiles`);
  const override =
    sector && sector !== 'holding' && profileId
      ? config.ai.sectorProfiles[sector]?.[profileId]
      : undefined;
  return override ? { ...profile, ...override } : profile;
}
