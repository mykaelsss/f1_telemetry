import { useQuery } from "@tanstack/react-query";
import { fetchEventSchedule } from "../api";

export function useEventSchedule(year: string, event: string) {
  return useQuery({
    queryKey: ["eventSchedule", year, event],
    queryFn: () => fetchEventSchedule(year, event),
    enabled: !!year && !!event,
    placeholderData: (previousData) => previousData,
  });
}

export function useSessionLapsStaleTime(
  year: string,
  event: string,
  session: string,
): number {
  const { data: eventSchedule } = useEventSchedule(year, event);
  const sessionStatus = eventSchedule?.sessions.find(
    (s) => s.identifier === session,
  )?.status;
  return sessionStatus === "completed" ? Infinity : 60_000;
}
