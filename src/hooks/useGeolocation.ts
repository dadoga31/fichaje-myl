import { useCallback } from 'react'
import type { Company, Profile, PunchGeo } from '../lib/types'

/**
 * Captura de ubicación al fichar, subordinada a dos condiciones acumulativas:
 * que la empresa la tenga activada Y que la persona haya consentido.
 * Si la política es 'optional', un rechazo o un error NO impide fichar:
 * el registro horario es la obligación legal; la ubicación, no.
 */
export function useGeolocation(company: Company | null, profile: Profile | null) {
  const enabled =
    !!company && company.geolocation_policy !== 'disabled' && !!profile?.geo_consent

  const capture = useCallback(async (): Promise<PunchGeo | null> => {
    if (!enabled || !('geolocation' in navigator)) return null

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60_000,
        })
      })
      return {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracy: Math.round(position.coords.accuracy),
      }
    } catch {
      if (company?.geolocation_policy === 'required') {
        throw new Error(
          'No se ha podido obtener la ubicación y su empresa la exige para fichar.',
        )
      }
      return null
    }
  }, [enabled, company])

  return { enabled, capture }
}
