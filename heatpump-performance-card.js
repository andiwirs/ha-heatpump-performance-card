import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

// Utility: Calculates the difference in days between two dates
const dateDiffInDays = (a, b) => {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((utc2 - utc1) / MS_PER_DAY);
};

class HaDateRangeService {
  constructor(hass) {
    this.hass = hass;
    this.TIMEOUT = 10000;
    this.listeners = [];
    this.pollStartAt = Date.now();
    this.getEnergyDataCollectionPoll((con) => this.onConnect(con));
  }

  onConnect(energyCollection) {
    this.connection = energyCollection.subscribe((collection) => {
      this.listeners.forEach((callback) => callback(collection));
    });
  }

  // Polls for the energy data collection from Home Assistant connection
  getEnergyDataCollectionPoll(complete) {
    const energyCollection = this.hass.connection["_energy"];
    if (energyCollection) {
      complete(energyCollection);
    } else if (Date.now() - this.pollStartAt > this.TIMEOUT) {
      console.error(
        "Energy data selector not found. Please add an 'energy-date-selection' card."
      );
    } else {
      setTimeout(() => this.getEnergyDataCollectionPoll(complete), 100);
    }
  }

  onDateRangeChange(method) {
    this.listeners.push(method);
  }

  disconnect() {
    this.listeners = [];
    if (this.connection) this.connection();
  }
}

class HeatpumpPerformanceCardConfig {
  constructor(config) {
    if (!config.entities || config.entities.length !== 2) {
      throw new Error("Exactly two entities must be specified.");
    }
    this.entities = config.entities.map((e) => ({
      entity: e.entity,
      name: e.name || e.entity,
    }));
    // Card header name configurable in YAML (default is empty string)
    this.name = config.name || "";
    // COP row name configurable in YAML (default: "COP")
    this.copName = config.cop_name || "COP";
  }
}

class HeatpumpPerformanceCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { attribute: false },
    values: { type: Object },
    cop: { type: String },
  };

  constructor() {
    super();
    this.values = {};
    this.cop = "-";
    this._needsInit = true;
  }

  setConfig(config) {
    this.config = config;
    this.cardConfig = new HeatpumpPerformanceCardConfig(config);
  }

  init() {
    if (!this.hass) return;

    this.cardConfig.entities.forEach((entity) => {
      const state = this.hass.states[entity.entity];
      if (!state) {
        this.values[entity.entity] = { value: "Unknown entity", unit: "-" };
      } else {
        this.values[entity.entity] = {
          value: state.state,
          unit: state.attributes.unit_of_measurement || "-",
        };
      }
    });

    this.dateRangeService = new HaDateRangeService(this.hass);
    this.dateRangeService.onDateRangeChange((range) =>
      this.loadData(range.start, range.end)
    );
    this._needsInit = false;
  }

  async loadData(start, end) {
    const dayDifference = dateDiffInDays(start, end);
    const period = dayDifference > 35 ? "month" : dayDifference > 2 ? "day" : "hour";

    for (const entity of this.cardConfig.entities) {
      try {
        const results = await this.hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: start.toISOString(),
          end_time: end?.toISOString(),
          statistic_ids: [entity.entity],
          period,
          types: ["change"],
        });

        const total = results[entity.entity]?.reduce((sum, e) => sum + e.change, 0) || 0;
        this.values[entity.entity] = {
          value: new Intl.NumberFormat().format(total),
          unit: this.hass.states[entity.entity]?.attributes?.unit_of_measurement || "-",
        };
      } catch (e) {
        console.error("Data retrieval failed:", e);
      }
    }
    this.calculateCOP();
  }

  calculateCOP() {
    const [electrical, thermal] = Object.values(this.values);
    const parseNumber = (str) => parseFloat(str.replace(/[^\d,]/g, "").replace(",", "."));

    const elec = parseNumber(electrical?.value);
    const therm = parseNumber(thermal?.value);
    
    if (!elec || !therm || elec <= 0) {
      this.cop = "-";
      return;
    }

    const cop = therm / elec;
    this.cop = cop.toLocaleString("de-DE", { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    });
  }

  render() {
    if (this._needsInit) this.init();

    return html`
      <ha-card>
        <div class="card-header">${this.cardConfig.name}</div>
        <div class="card-content">
          ${this.cardConfig.entities.map(
            (e) => html`
              <div class="row">
                <span>${e.name}</span>
                <div>
                  ${this.values[e.entity]?.value || "-"}
                  <span class="unit">${this.values[e.entity]?.unit || "-"}</span>
                </div>
              </div>
            `
          )}
          <div class="row">
            <span>${this.cardConfig.copName}</span>
            <div>${this.cop}</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    ha-card {
      --ha-card-border-radius: var(--border-radius);
      --ha-card-box-shadow: var(--box-shadow);
      --ha-card-background: var(--card-background-color);
      overflow: hidden;
    }

    .card-header {
      font-size: 16px;
      font-weight: 500;
      padding: 16px;
      color: var(--ha-card-header-color, --primary-text-color);
      border-bottom: 1px solid var(--divider-color);
    }

    .card-content {
      padding: 16px;
      font-size: 14px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      color: var(--primary-text-color);
    }

    .unit {
      font-size: 0.8em;
      opacity: 0.75;
      margin-left: 4px;
    }
  `;

  disconnectedCallback() {
    this.dateRangeService?.disconnect();
    super.disconnectedCallback();
  }
}

// Register component
if (!customElements.get("heatpump-performance-card")) {
  customElements.define("heatpump-performance-card", HeatpumpPerformanceCard);
  console.info(
    `%c andiwirs/ha-heatpump-performance-card %c v1.0.0 `
  )
}

// Register card
window.customCards.push({
    name: 'Heatpump Performance Card',
    description: 'A simple card to calculate a heatpump COP that integrates with the `energy-date-selection`',
    type: 'heatpump-performance-card',
    preview: false,
    documentationURL: `https://github.com/andiwirs/ha-heatpump-performance-card`,
});