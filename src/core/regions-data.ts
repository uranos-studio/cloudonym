// 생성 파일 — 손으로 고치지 않는다. scripts/catalog/build-catalog.mjs 가 catalog/regions.json 에서 만든다 (D46 · D49).
// 지역 코드 표 — GCP 는 리전 · 존, AWS · Azure 는 리전만. status: GCP final · AWS · Azure draft
import type { Provider } from './types';

export interface ZoneEntry { zone: string; code: string }
export interface RegionEntry { region: string; code: string; zones: readonly ZoneEntry[]; label: string }

export const REGIONS_META = {
  "gcp": {
    "status": "final",
    "source": "https://cloud.google.com/compute/docs/regions-zones"
  },
  "aws": {
    "status": "draft",
    "source": "https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html"
  },
  "azure": {
    "status": "draft",
    "source": "https://learn.microsoft.com/en-us/azure/reliability/regions-list"
  }
} as const;

export const REGIONS: Readonly<Record<Provider, readonly RegionEntry[]>> = {
  "gcp": [
    {
      "region": "africa-south1",
      "code": "afs1",
      "zones": [
        {
          "zone": "africa-south1-a",
          "code": "afs1a"
        },
        {
          "zone": "africa-south1-b",
          "code": "afs1b"
        },
        {
          "zone": "africa-south1-c",
          "code": "afs1c"
        }
      ],
      "label": "Johannesburg, South Africa"
    },
    {
      "region": "asia-east1",
      "code": "ae1",
      "zones": [
        {
          "zone": "asia-east1-a",
          "code": "ae1a"
        },
        {
          "zone": "asia-east1-b",
          "code": "ae1b"
        },
        {
          "zone": "asia-east1-c",
          "code": "ae1c"
        }
      ],
      "label": "Changhua County, Taiwan, APAC"
    },
    {
      "region": "asia-east2",
      "code": "ae2",
      "zones": [
        {
          "zone": "asia-east2-a",
          "code": "ae2a"
        },
        {
          "zone": "asia-east2-b",
          "code": "ae2b"
        },
        {
          "zone": "asia-east2-c",
          "code": "ae2c"
        }
      ],
      "label": "Hong Kong, APAC"
    },
    {
      "region": "asia-northeast1",
      "code": "ane1",
      "zones": [
        {
          "zone": "asia-northeast1-a",
          "code": "ane1a"
        },
        {
          "zone": "asia-northeast1-b",
          "code": "ane1b"
        },
        {
          "zone": "asia-northeast1-c",
          "code": "ane1c"
        }
      ],
      "label": "Tokyo, Japan, APAC"
    },
    {
      "region": "asia-northeast2",
      "code": "ane2",
      "zones": [
        {
          "zone": "asia-northeast2-a",
          "code": "ane2a"
        },
        {
          "zone": "asia-northeast2-b",
          "code": "ane2b"
        },
        {
          "zone": "asia-northeast2-c",
          "code": "ane2c"
        }
      ],
      "label": "Osaka, Japan, APAC"
    },
    {
      "region": "asia-northeast3",
      "code": "ane3",
      "zones": [
        {
          "zone": "asia-northeast3-a",
          "code": "ane3a"
        },
        {
          "zone": "asia-northeast3-b",
          "code": "ane3b"
        },
        {
          "zone": "asia-northeast3-c",
          "code": "ane3c"
        }
      ],
      "label": "Seoul, South Korea, APAC"
    },
    {
      "region": "asia-south1",
      "code": "as1",
      "zones": [
        {
          "zone": "asia-south1-a",
          "code": "as1a"
        },
        {
          "zone": "asia-south1-b",
          "code": "as1b"
        },
        {
          "zone": "asia-south1-c",
          "code": "as1c"
        }
      ],
      "label": "Mumbai, India, APAC"
    },
    {
      "region": "asia-south2",
      "code": "as2",
      "zones": [
        {
          "zone": "asia-south2-a",
          "code": "as2a"
        },
        {
          "zone": "asia-south2-b",
          "code": "as2b"
        },
        {
          "zone": "asia-south2-c",
          "code": "as2c"
        }
      ],
      "label": "Delhi, India, APAC"
    },
    {
      "region": "asia-southeast1",
      "code": "ase1",
      "zones": [
        {
          "zone": "asia-southeast1-a",
          "code": "ase1a"
        },
        {
          "zone": "asia-southeast1-b",
          "code": "ase1b"
        },
        {
          "zone": "asia-southeast1-c",
          "code": "ase1c"
        }
      ],
      "label": "Jurong West, Singapore, APAC"
    },
    {
      "region": "asia-southeast2",
      "code": "ase2",
      "zones": [
        {
          "zone": "asia-southeast2-a",
          "code": "ase2a"
        },
        {
          "zone": "asia-southeast2-b",
          "code": "ase2b"
        },
        {
          "zone": "asia-southeast2-c",
          "code": "ase2c"
        }
      ],
      "label": "Jakarta, Indonesia, APAC"
    },
    {
      "region": "asia-southeast3",
      "code": "ase3",
      "zones": [
        {
          "zone": "asia-southeast3-a",
          "code": "ase3a"
        },
        {
          "zone": "asia-southeast3-b",
          "code": "ase3b"
        },
        {
          "zone": "asia-southeast3-c",
          "code": "ase3c"
        }
      ],
      "label": "Bangkok, Thailand, APAC"
    },
    {
      "region": "australia-southeast1",
      "code": "ause1",
      "zones": [
        {
          "zone": "australia-southeast1-a",
          "code": "ause1a"
        },
        {
          "zone": "australia-southeast1-b",
          "code": "ause1b"
        },
        {
          "zone": "australia-southeast1-c",
          "code": "ause1c"
        }
      ],
      "label": "Sydney, Australia, APAC"
    },
    {
      "region": "australia-southeast2",
      "code": "ause2",
      "zones": [
        {
          "zone": "australia-southeast2-a",
          "code": "ause2a"
        },
        {
          "zone": "australia-southeast2-b",
          "code": "ause2b"
        },
        {
          "zone": "australia-southeast2-c",
          "code": "ause2c"
        }
      ],
      "label": "Melbourne, Australia, APAC"
    },
    {
      "region": "europe-north1",
      "code": "eun1",
      "zones": [
        {
          "zone": "europe-north1-a",
          "code": "eun1a"
        },
        {
          "zone": "europe-north1-b",
          "code": "eun1b"
        },
        {
          "zone": "europe-north1-c",
          "code": "eun1c"
        }
      ],
      "label": "Hamina, Finland, Europe"
    },
    {
      "region": "europe-north2",
      "code": "eun2",
      "zones": [
        {
          "zone": "europe-north2-a",
          "code": "eun2a"
        },
        {
          "zone": "europe-north2-b",
          "code": "eun2b"
        },
        {
          "zone": "europe-north2-c",
          "code": "eun2c"
        }
      ],
      "label": "Stockholm, Sweden, Europe"
    },
    {
      "region": "europe-central2",
      "code": "euc2",
      "zones": [
        {
          "zone": "europe-central2-a",
          "code": "euc2a"
        },
        {
          "zone": "europe-central2-b",
          "code": "euc2b"
        },
        {
          "zone": "europe-central2-c",
          "code": "euc2c"
        }
      ],
      "label": "Warsaw, Poland, Europe"
    },
    {
      "region": "europe-southwest1",
      "code": "eusw1",
      "zones": [
        {
          "zone": "europe-southwest1-a",
          "code": "eusw1a"
        },
        {
          "zone": "europe-southwest1-b",
          "code": "eusw1b"
        },
        {
          "zone": "europe-southwest1-c",
          "code": "eusw1c"
        }
      ],
      "label": "Madrid, Spain, Europe"
    },
    {
      "region": "europe-west1",
      "code": "euw1",
      "zones": [
        {
          "zone": "europe-west1-b",
          "code": "euw1b"
        },
        {
          "zone": "europe-west1-c",
          "code": "euw1c"
        },
        {
          "zone": "europe-west1-d",
          "code": "euw1d"
        }
      ],
      "label": "St. Ghislain, Belgium, Europe"
    },
    {
      "region": "europe-west2",
      "code": "euw2",
      "zones": [
        {
          "zone": "europe-west2-a",
          "code": "euw2a"
        },
        {
          "zone": "europe-west2-b",
          "code": "euw2b"
        },
        {
          "zone": "europe-west2-c",
          "code": "euw2c"
        }
      ],
      "label": "London, England, Europe"
    },
    {
      "region": "europe-west3",
      "code": "euw3",
      "zones": [
        {
          "zone": "europe-west3-a",
          "code": "euw3a"
        },
        {
          "zone": "europe-west3-b",
          "code": "euw3b"
        },
        {
          "zone": "europe-west3-c",
          "code": "euw3c"
        }
      ],
      "label": "Frankfurt, Germany, Europe"
    },
    {
      "region": "europe-west4",
      "code": "euw4",
      "zones": [
        {
          "zone": "europe-west4-a",
          "code": "euw4a"
        },
        {
          "zone": "europe-west4-b",
          "code": "euw4b"
        },
        {
          "zone": "europe-west4-c",
          "code": "euw4c"
        }
      ],
      "label": "Eemshaven, Netherlands, Europe"
    },
    {
      "region": "europe-west6",
      "code": "euw6",
      "zones": [
        {
          "zone": "europe-west6-a",
          "code": "euw6a"
        },
        {
          "zone": "europe-west6-b",
          "code": "euw6b"
        },
        {
          "zone": "europe-west6-c",
          "code": "euw6c"
        }
      ],
      "label": "Zurich, Switzerland, Europe"
    },
    {
      "region": "europe-west8",
      "code": "euw8",
      "zones": [
        {
          "zone": "europe-west8-a",
          "code": "euw8a"
        },
        {
          "zone": "europe-west8-b",
          "code": "euw8b"
        },
        {
          "zone": "europe-west8-c",
          "code": "euw8c"
        }
      ],
      "label": "Milan, Italy, Europe"
    },
    {
      "region": "europe-west9",
      "code": "euw9",
      "zones": [
        {
          "zone": "europe-west9-a",
          "code": "euw9a"
        },
        {
          "zone": "europe-west9-b",
          "code": "euw9b"
        },
        {
          "zone": "europe-west9-c",
          "code": "euw9c"
        }
      ],
      "label": "Paris, France, Europe"
    },
    {
      "region": "europe-west10",
      "code": "euw10",
      "zones": [
        {
          "zone": "europe-west10-a",
          "code": "euw10a"
        },
        {
          "zone": "europe-west10-b",
          "code": "euw10b"
        },
        {
          "zone": "europe-west10-c",
          "code": "euw10c"
        }
      ],
      "label": "Berlin, Germany, Europe"
    },
    {
      "region": "europe-west12",
      "code": "euw12",
      "zones": [
        {
          "zone": "europe-west12-a",
          "code": "euw12a"
        },
        {
          "zone": "europe-west12-b",
          "code": "euw12b"
        },
        {
          "zone": "europe-west12-c",
          "code": "euw12c"
        }
      ],
      "label": "Turin, Italy, Europe"
    },
    {
      "region": "me-central1",
      "code": "mec1",
      "zones": [
        {
          "zone": "me-central1-a",
          "code": "mec1a"
        },
        {
          "zone": "me-central1-b",
          "code": "mec1b"
        },
        {
          "zone": "me-central1-c",
          "code": "mec1c"
        }
      ],
      "label": "Doha, Qatar, Middle East"
    },
    {
      "region": "me-central2",
      "code": "mec2",
      "zones": [
        {
          "zone": "me-central2-a",
          "code": "mec2a"
        },
        {
          "zone": "me-central2-b",
          "code": "mec2b"
        },
        {
          "zone": "me-central2-c",
          "code": "mec2c"
        }
      ],
      "label": "Dammam, Saudi Arabia, Middle East"
    },
    {
      "region": "me-west1",
      "code": "mew1",
      "zones": [
        {
          "zone": "me-west1-a",
          "code": "mew1a"
        },
        {
          "zone": "me-west1-b",
          "code": "mew1b"
        },
        {
          "zone": "me-west1-c",
          "code": "mew1c"
        }
      ],
      "label": "Tel Aviv, Israel, Middle East"
    },
    {
      "region": "northamerica-northeast1",
      "code": "nane1",
      "zones": [
        {
          "zone": "northamerica-northeast1-a",
          "code": "nane1a"
        },
        {
          "zone": "northamerica-northeast1-b",
          "code": "nane1b"
        },
        {
          "zone": "northamerica-northeast1-c",
          "code": "nane1c"
        }
      ],
      "label": "Montréal, Québec, North America"
    },
    {
      "region": "northamerica-northeast2",
      "code": "nane2",
      "zones": [
        {
          "zone": "northamerica-northeast2-a",
          "code": "nane2a"
        },
        {
          "zone": "northamerica-northeast2-b",
          "code": "nane2b"
        },
        {
          "zone": "northamerica-northeast2-c",
          "code": "nane2c"
        }
      ],
      "label": "Toronto, Ontario, North America"
    },
    {
      "region": "northamerica-south1",
      "code": "nas1",
      "zones": [
        {
          "zone": "northamerica-south1-a",
          "code": "nas1a"
        },
        {
          "zone": "northamerica-south1-b",
          "code": "nas1b"
        },
        {
          "zone": "northamerica-south1-c",
          "code": "nas1c"
        }
      ],
      "label": "Queretaro, Mexico, North America"
    },
    {
      "region": "southamerica-east1",
      "code": "sae1",
      "zones": [
        {
          "zone": "southamerica-east1-a",
          "code": "sae1a"
        },
        {
          "zone": "southamerica-east1-b",
          "code": "sae1b"
        },
        {
          "zone": "southamerica-east1-c",
          "code": "sae1c"
        }
      ],
      "label": "Osasco, São Paulo, Brazil, South America"
    },
    {
      "region": "southamerica-west1",
      "code": "saw1",
      "zones": [
        {
          "zone": "southamerica-west1-a",
          "code": "saw1a"
        },
        {
          "zone": "southamerica-west1-b",
          "code": "saw1b"
        },
        {
          "zone": "southamerica-west1-c",
          "code": "saw1c"
        }
      ],
      "label": "Santiago, Chile, South America"
    },
    {
      "region": "us-central1",
      "code": "usc1",
      "zones": [
        {
          "zone": "us-central1-a",
          "code": "usc1a"
        },
        {
          "zone": "us-central1-b",
          "code": "usc1b"
        },
        {
          "zone": "us-central1-c",
          "code": "usc1c"
        },
        {
          "zone": "us-central1-f",
          "code": "usc1f"
        }
      ],
      "label": "Council Bluffs, Iowa, North America"
    },
    {
      "region": "us-east1",
      "code": "use1",
      "zones": [
        {
          "zone": "us-east1-b",
          "code": "use1b"
        },
        {
          "zone": "us-east1-c",
          "code": "use1c"
        },
        {
          "zone": "us-east1-d",
          "code": "use1d"
        }
      ],
      "label": "Moncks Corner, South Carolina, North America"
    },
    {
      "region": "us-east4",
      "code": "use4",
      "zones": [
        {
          "zone": "us-east4-a",
          "code": "use4a"
        },
        {
          "zone": "us-east4-b",
          "code": "use4b"
        },
        {
          "zone": "us-east4-c",
          "code": "use4c"
        }
      ],
      "label": "Ashburn, Virginia, North America"
    },
    {
      "region": "us-east5",
      "code": "use5",
      "zones": [
        {
          "zone": "us-east5-a",
          "code": "use5a"
        },
        {
          "zone": "us-east5-b",
          "code": "use5b"
        },
        {
          "zone": "us-east5-c",
          "code": "use5c"
        }
      ],
      "label": "Columbus, Ohio, North America"
    },
    {
      "region": "us-south1",
      "code": "uss1",
      "zones": [
        {
          "zone": "us-south1-a",
          "code": "uss1a"
        },
        {
          "zone": "us-south1-b",
          "code": "uss1b"
        },
        {
          "zone": "us-south1-c",
          "code": "uss1c"
        }
      ],
      "label": "Dallas, Texas, North America"
    },
    {
      "region": "us-west1",
      "code": "usw1",
      "zones": [
        {
          "zone": "us-west1-a",
          "code": "usw1a"
        },
        {
          "zone": "us-west1-b",
          "code": "usw1b"
        },
        {
          "zone": "us-west1-c",
          "code": "usw1c"
        }
      ],
      "label": "The Dalles, Oregon, North America"
    },
    {
      "region": "us-west2",
      "code": "usw2",
      "zones": [
        {
          "zone": "us-west2-a",
          "code": "usw2a"
        },
        {
          "zone": "us-west2-b",
          "code": "usw2b"
        },
        {
          "zone": "us-west2-c",
          "code": "usw2c"
        }
      ],
      "label": "Los Angeles, California, North America"
    },
    {
      "region": "us-west3",
      "code": "usw3",
      "zones": [
        {
          "zone": "us-west3-a",
          "code": "usw3a"
        },
        {
          "zone": "us-west3-b",
          "code": "usw3b"
        },
        {
          "zone": "us-west3-c",
          "code": "usw3c"
        }
      ],
      "label": "Salt Lake City, Utah, North America"
    },
    {
      "region": "us-west4",
      "code": "usw4",
      "zones": [
        {
          "zone": "us-west4-a",
          "code": "usw4a"
        },
        {
          "zone": "us-west4-b",
          "code": "usw4b"
        },
        {
          "zone": "us-west4-c",
          "code": "usw4c"
        }
      ],
      "label": "Las Vegas, Nevada, North America"
    }
  ],
  "aws": [
    {
      "region": "us-east-1",
      "code": "use1",
      "zones": [],
      "label": "US East (N. Virginia)"
    },
    {
      "region": "us-east-2",
      "code": "use2",
      "zones": [],
      "label": "US East (Ohio)"
    },
    {
      "region": "us-west-1",
      "code": "usw1",
      "zones": [],
      "label": "US West (N. California)"
    },
    {
      "region": "us-west-2",
      "code": "usw2",
      "zones": [],
      "label": "US West (Oregon)"
    },
    {
      "region": "af-south-1",
      "code": "afs1",
      "zones": [],
      "label": "Africa (Cape Town)"
    },
    {
      "region": "ap-east-1",
      "code": "ape1",
      "zones": [],
      "label": "Asia Pacific (Hong Kong)"
    },
    {
      "region": "ap-south-2",
      "code": "aps2",
      "zones": [],
      "label": "Asia Pacific (Hyderabad)"
    },
    {
      "region": "ap-southeast-3",
      "code": "apse3",
      "zones": [],
      "label": "Asia Pacific (Jakarta)"
    },
    {
      "region": "ap-southeast-5",
      "code": "apse5",
      "zones": [],
      "label": "Asia Pacific (Malaysia)"
    },
    {
      "region": "ap-southeast-4",
      "code": "apse4",
      "zones": [],
      "label": "Asia Pacific (Melbourne)"
    },
    {
      "region": "ap-south-1",
      "code": "aps1",
      "zones": [],
      "label": "Asia Pacific (Mumbai)"
    },
    {
      "region": "ap-southeast-6",
      "code": "apse6",
      "zones": [],
      "label": "Asia Pacific (New Zealand)"
    },
    {
      "region": "ap-northeast-3",
      "code": "apne3",
      "zones": [],
      "label": "Asia Pacific (Osaka)"
    },
    {
      "region": "ap-northeast-2",
      "code": "apne2",
      "zones": [],
      "label": "Asia Pacific (Seoul)"
    },
    {
      "region": "ap-southeast-1",
      "code": "apse1",
      "zones": [],
      "label": "Asia Pacific (Singapore)"
    },
    {
      "region": "ap-southeast-2",
      "code": "apse2",
      "zones": [],
      "label": "Asia Pacific (Sydney)"
    },
    {
      "region": "ap-east-2",
      "code": "ape2",
      "zones": [],
      "label": "Asia Pacific (Taipei)"
    },
    {
      "region": "ap-southeast-7",
      "code": "apse7",
      "zones": [],
      "label": "Asia Pacific (Thailand)"
    },
    {
      "region": "ap-northeast-1",
      "code": "apne1",
      "zones": [],
      "label": "Asia Pacific (Tokyo)"
    },
    {
      "region": "ca-central-1",
      "code": "cac1",
      "zones": [],
      "label": "Canada (Central)"
    },
    {
      "region": "ca-west-1",
      "code": "caw1",
      "zones": [],
      "label": "Canada West (Calgary)"
    },
    {
      "region": "eu-central-1",
      "code": "euc1",
      "zones": [],
      "label": "Europe (Frankfurt)"
    },
    {
      "region": "eu-west-1",
      "code": "euw1",
      "zones": [],
      "label": "Europe (Ireland)"
    },
    {
      "region": "eu-west-2",
      "code": "euw2",
      "zones": [],
      "label": "Europe (London)"
    },
    {
      "region": "eu-south-1",
      "code": "eus1",
      "zones": [],
      "label": "Europe (Milan)"
    },
    {
      "region": "eu-west-3",
      "code": "euw3",
      "zones": [],
      "label": "Europe (Paris)"
    },
    {
      "region": "eu-south-2",
      "code": "eus2",
      "zones": [],
      "label": "Europe (Spain)"
    },
    {
      "region": "eu-north-1",
      "code": "eun1",
      "zones": [],
      "label": "Europe (Stockholm)"
    },
    {
      "region": "eu-central-2",
      "code": "euc2",
      "zones": [],
      "label": "Europe (Zurich)"
    },
    {
      "region": "il-central-1",
      "code": "ilc1",
      "zones": [],
      "label": "Israel (Tel Aviv)"
    },
    {
      "region": "mx-central-1",
      "code": "mxc1",
      "zones": [],
      "label": "Mexico (Central)"
    },
    {
      "region": "me-south-1",
      "code": "mes1",
      "zones": [],
      "label": "Middle East (Bahrain)"
    },
    {
      "region": "me-central-1",
      "code": "mec1",
      "zones": [],
      "label": "Middle East (UAE)"
    },
    {
      "region": "sa-east-1",
      "code": "sae1",
      "zones": [],
      "label": "South America (São Paulo)"
    }
  ],
  "azure": [
    {
      "region": "australiacentral",
      "code": "acl",
      "zones": [],
      "label": "Australia Central"
    },
    {
      "region": "australiacentral2",
      "code": "acl2",
      "zones": [],
      "label": "Australia Central 2"
    },
    {
      "region": "australiaeast",
      "code": "ae",
      "zones": [],
      "label": "Australia East"
    },
    {
      "region": "australiasoutheast",
      "code": "ase",
      "zones": [],
      "label": "Australia Southeast"
    },
    {
      "region": "austriaeast",
      "code": "aue",
      "zones": [],
      "label": "Austria East"
    },
    {
      "region": "belgiumcentral",
      "code": "bec",
      "zones": [],
      "label": "Belgium Central"
    },
    {
      "region": "brazilsouth",
      "code": "brs",
      "zones": [],
      "label": "Brazil South"
    },
    {
      "region": "brazilsoutheast",
      "code": "bse",
      "zones": [],
      "label": "Brazil Southeast"
    },
    {
      "region": "canadacentral",
      "code": "cnc",
      "zones": [],
      "label": "Canada Central"
    },
    {
      "region": "canadaeast",
      "code": "cne",
      "zones": [],
      "label": "Canada East"
    },
    {
      "region": "centralindia",
      "code": "inc",
      "zones": [],
      "label": "Central India"
    },
    {
      "region": "centralus",
      "code": "cus",
      "zones": [],
      "label": "Central US"
    },
    {
      "region": "chilecentral",
      "code": "clc",
      "zones": [],
      "label": "Chile Central"
    },
    {
      "region": "denmarkeast",
      "code": "dke",
      "zones": [],
      "label": "Denmark East"
    },
    {
      "region": "eastasia",
      "code": "ea",
      "zones": [],
      "label": "East Asia"
    },
    {
      "region": "eastus",
      "code": "eus",
      "zones": [],
      "label": "East US"
    },
    {
      "region": "eastus2",
      "code": "eus2",
      "zones": [],
      "label": "East US 2"
    },
    {
      "region": "francecentral",
      "code": "frc",
      "zones": [],
      "label": "France Central"
    },
    {
      "region": "francesouth",
      "code": "frs",
      "zones": [],
      "label": "France South"
    },
    {
      "region": "germanynorth",
      "code": "gn",
      "zones": [],
      "label": "Germany North"
    },
    {
      "region": "germanywestcentral",
      "code": "gwc",
      "zones": [],
      "label": "Germany West Central"
    },
    {
      "region": "indiasouthcentral",
      "code": "insc",
      "zones": [],
      "label": "India South Central"
    },
    {
      "region": "indonesiacentral",
      "code": "idc",
      "zones": [],
      "label": "Indonesia Central"
    },
    {
      "region": "israelcentral",
      "code": "ilc",
      "zones": [],
      "label": "Israel Central"
    },
    {
      "region": "italynorth",
      "code": "itn",
      "zones": [],
      "label": "Italy North"
    },
    {
      "region": "japaneast",
      "code": "jpe",
      "zones": [],
      "label": "Japan East"
    },
    {
      "region": "japanwest",
      "code": "jpw",
      "zones": [],
      "label": "Japan West"
    },
    {
      "region": "koreacentral",
      "code": "krc",
      "zones": [],
      "label": "Korea Central"
    },
    {
      "region": "koreasouth",
      "code": "krs",
      "zones": [],
      "label": "Korea South"
    },
    {
      "region": "malaysiawest",
      "code": "myw",
      "zones": [],
      "label": "Malaysia West"
    },
    {
      "region": "mexicocentral",
      "code": "mxc",
      "zones": [],
      "label": "Mexico Central"
    },
    {
      "region": "newzealandnorth",
      "code": "nzn",
      "zones": [],
      "label": "New Zealand North"
    },
    {
      "region": "northcentralus",
      "code": "ncus",
      "zones": [],
      "label": "North Central US"
    },
    {
      "region": "northeurope",
      "code": "ne",
      "zones": [],
      "label": "North Europe"
    },
    {
      "region": "norwayeast",
      "code": "nwe",
      "zones": [],
      "label": "Norway East"
    },
    {
      "region": "norwaywest",
      "code": "nww",
      "zones": [],
      "label": "Norway West"
    },
    {
      "region": "polandcentral",
      "code": "plc",
      "zones": [],
      "label": "Poland Central"
    },
    {
      "region": "qatarcentral",
      "code": "qac",
      "zones": [],
      "label": "Qatar Central"
    },
    {
      "region": "southafricanorth",
      "code": "san",
      "zones": [],
      "label": "South Africa North"
    },
    {
      "region": "southafricawest",
      "code": "saw",
      "zones": [],
      "label": "South Africa West"
    },
    {
      "region": "southcentralus",
      "code": "scus",
      "zones": [],
      "label": "South Central US"
    },
    {
      "region": "southindia",
      "code": "ins",
      "zones": [],
      "label": "South India"
    },
    {
      "region": "southeastasia",
      "code": "sea",
      "zones": [],
      "label": "Southeast Asia"
    },
    {
      "region": "spaincentral",
      "code": "spc",
      "zones": [],
      "label": "Spain Central"
    },
    {
      "region": "swedencentral",
      "code": "sdc",
      "zones": [],
      "label": "Sweden Central"
    },
    {
      "region": "switzerlandnorth",
      "code": "szn",
      "zones": [],
      "label": "Switzerland North"
    },
    {
      "region": "switzerlandwest",
      "code": "szw",
      "zones": [],
      "label": "Switzerland West"
    },
    {
      "region": "uaecentral",
      "code": "uac",
      "zones": [],
      "label": "UAE Central"
    },
    {
      "region": "uaenorth",
      "code": "uan",
      "zones": [],
      "label": "UAE North"
    },
    {
      "region": "uksouth",
      "code": "uks",
      "zones": [],
      "label": "UK South"
    },
    {
      "region": "ukwest",
      "code": "ukw",
      "zones": [],
      "label": "UK West"
    },
    {
      "region": "westcentralus",
      "code": "wcus",
      "zones": [],
      "label": "West Central US"
    },
    {
      "region": "westeurope",
      "code": "we",
      "zones": [],
      "label": "West Europe"
    },
    {
      "region": "westindia",
      "code": "inw",
      "zones": [],
      "label": "West India"
    },
    {
      "region": "westus",
      "code": "wus",
      "zones": [],
      "label": "West US"
    },
    {
      "region": "westus2",
      "code": "wus2",
      "zones": [],
      "label": "West US 2"
    },
    {
      "region": "westus3",
      "code": "wus3",
      "zones": [],
      "label": "West US 3"
    }
  ]
};
