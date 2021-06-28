let apiHostIndexCursor = 0;
let apiHosts: string[] = [];

export const FAKE_FARGATE_API_HOST = "FAKE_FARGATE_API_HOST";

export const setLoadTestingApiHosts = (hosts: string[]) => {
  apiHosts = hosts;
};

// round robin api host choice
export const loadTestingChooseHost = (): string => {
  if (!apiHosts.length) {
    throw new Error("No api hosts");
  }
  const lastIndex = apiHosts.length - 1;
  apiHostIndexCursor++;
  if (apiHostIndexCursor > lastIndex) {
    apiHostIndexCursor = 0;
  }
  return apiHosts[apiHostIndexCursor];
};

export const getLoadTestingApiHosts = (): string[] => [...apiHosts];
