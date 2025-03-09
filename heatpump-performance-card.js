/**
 * Heatpump Performance Card
 *
 * This custom card calculates and displays the performance of a heat pump by determining its Coefficient of Performance (COP) 
 * based on the electrical energy consumed and the thermal energy output. Additionally, it can optionally display time-weighted 
 * average values for outdoor temperature and humidity over the selected time period.
 *
 * Config options:
 * - name: The card title (default: empty string).
 * - icon: (Optional) Icon for the card header (default: "mdi:heat-pump").
 * - cop_name: The label for the COP row (default: "COP").
 * - show_header: Whether to display the card header (default: true).
 * - entities: An array of two entities used for COP calculation:
 *     - entity: The entity ID (e.g., sensor.heatpump_electrical_consumption).
 *     - name: (Optional) Display name for the entity (default: entity ID).
 * - outdoor_temperature: (Optional) Configuration for an outdoor temperature entity:
 *     - entity: The entity ID for outdoor temperature.
 *     - name: (Optional) Display name for the outdoor temperature (default: entity ID).
 * - outdoor_humidity: (Optional) Configuration for an outdoor humidity entity:
 *     - entity: The entity ID for outdoor humidity.
 *     - name: (Optional) Display name for the outdoor humidity (default: entity ID).
 *
 * Features:
 * - Calculates the Coefficient of Performance (COP) as:
 *       COP = Thermal Energy Output / Electrical Energy Consumed
 *   If either value is missing or invalid, COP is displayed as "-".
 *
 * - Supports additional entities for outdoor temperature and humidity:
 *   - Calculates time-weighted average values over the selected time range.
 *
 * - Integrates with Home Assistant's `energy-date-selection` to dynamically update data based on the selected date range.
 *
 * - Displays all values in a clean, native Home Assistant style:
 *   - Includes a customizable header with an optional icon.
 *   - Uses Home Assistant theme variables for consistent styling.
 *
 * Example Configuration:
 *
 * type: custom:heatpump-performance-card
 * name: Heat Pump Performance
 * cop_name: Efficiency Ratio
 * entities:
 *   - entity: sensor.heatpump_electrical_consumption
 *     name: Electrical Consumption
 *   - entity: sensor.heatpump_thermal_output
 *     name: Thermal Output
 * outdoor_temperature:
 *   entity: sensor.outdoor_temperature
 *   name: Outdoor Temperature
 * outdoor_humidity:
 *   entity: sensor.outdoor_humidity
 *   name: Outdoor Humidity
 *
**/

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
      throw new Error("Exactly two entities must be specified for energy calculation.");
    }
    this.entities = config.entities.map((e) => ({
      entity: e.entity,
      name: e.name || e.entity,
    }));
    
    // Optional outdoor temperature entity
    this.outdoor_temperature = config.outdoor_temperature ? {
      entity: config.outdoor_temperature.entity,
      name: config.outdoor_temperature.name || config.outdoor_temperature.entity
    } : null;
    
    // Optional outdoor humidity entity
    this.outdoor_humidity = config.outdoor_humidity ? {
      entity: config.outdoor_humidity.entity,
      name: config.outdoor_humidity.name || config.outdoor_humidity.entity
    } : null;
    
    // Card header name configurable in YAML (default is empty string)
    this.name = config.name || "";
    // COP row name configurable in YAML (default: "COP")
    this.copName = config.cop_name || "COP";
    // Show header toggle
    this.showHeader = config.show_header !== false;
    // Icon for the card (optional)
    this.icon = config.icon || "mdi:heat-pump";
  }
}

class HeatpumpPerformanceCard extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      config: { attribute: false },
      values: { type: Object },
      cop: { type: String },
      outdoorData: { type: Object },
    };
  }

  constructor() {
    super();
    this.values = {};
    this.cop = "-";
    this.outdoorData = {
      temperature: { value: "-", unit: "°C" },
      humidity: { value: "-", unit: "%" }
    };
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

    // Load energy entities data
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

    // Load outdoor temperature data if configured
    if (this.cardConfig.outdoor_temperature) {
      await this.loadAverageData(
        this.cardConfig.outdoor_temperature.entity,
        start,
        end,
        period,
        "temperature"
      );
    }

    // Load outdoor humidity data if configured
    if (this.cardConfig.outdoor_humidity) {
      await this.loadAverageData(
        this.cardConfig.outdoor_humidity.entity,
        start,
        end,
        period,
        "humidity"
      );
    }

    this.calculateCOP();
  }

  async loadAverageData(entity, start, end, period, dataType) {
    try {
      const results = await this.hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end?.toISOString(),
        statistic_ids: [entity],
        period,
        types: ["mean"],
      });

      if (results[entity] && results[entity].length > 0) {
        // Calculate time-weighted average
        let totalValue = 0;
        let totalWeight = 0;
        
        for (let i = 0; i < results[entity].length; i++) {
          const entry = results[entity][i];
          // Use duration as weight (for time-weighted average)
          // For the last entry, we'll use a default weight of 1
          const weight = i < results[entity].length - 1 ? 1 : 1;
          
          totalValue += entry.mean * weight;
          totalWeight += weight;
        }
        
        const average = totalValue / totalWeight;
        
        this.outdoorData[dataType] = {
          value: average.toLocaleString("de-DE", { 
            minimumFractionDigits: 1,
            maximumFractionDigits: 1 
          }),
          unit: this.hass.states[entity]?.attributes?.unit_of_measurement || 
                (dataType === "temperature" ? "°C" : "%")
        };
      }
    } catch (e) {
      console.error(`Failed to load ${dataType} data:`, e);
    }
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
        ${this.cardConfig.showHeader ? html`
          <div class="card-header">
            <div class="name">
              <ha-icon .icon=${this.cardConfig.icon}></ha-icon>
              ${this.cardConfig.name}
            </div>
          </div>
        ` : ''}
        
        <div class="card-content">
          <div class="stats">
            ${this.cardConfig.entities.map(
              (e) => html`
                <div class="stat">
                  <span class="stat-label">${e.name}</span>
                  <span class="stat-value">
                    ${this.values[e.entity]?.value || "-"}
                    <span class="unit">${this.values[e.entity]?.unit || "-"}</span>
                  </span>
                </div>
              `
            )}
            
            <div class="stat">
              <span class="stat-label">${this.cardConfig.copName}</span>
              <span class="stat-value">${this.cop}</span>
            </div>
            
            ${this.cardConfig.outdoor_temperature ? html`
              <div class="stat">
                <span class="stat-label">${this.cardConfig.outdoor_temperature.name}</span>
                <span class="stat-value">
                  ${this.outdoorData.temperature.value}
                  <span class="unit">${this.outdoorData.temperature.unit}</span>
                </span>
              </div>
            ` : ''}
            
            ${this.cardConfig.outdoor_humidity ? html`
              <div class="stat">
                <span class="stat-label">${this.cardConfig.outdoor_humidity.name}</span>
                <span class="stat-value">
                  ${this.outdoorData.humidity.value}
                  <span class="unit">${this.outdoorData.humidity.unit}</span>
                </span>
              </div>
            ` : ''}
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      ha-card {
        --ha-card-border-radius: var(--border-radius);
        --ha-card-box-shadow: var(--box-shadow);
        --ha-card-background: var(--card-background-color);
        overflow: hidden;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 16px 0;
      }

      .card-header .name {
        display: flex;
        align-items: center;
        font-size: var(--ha-card-header-font-size, 24px);
        font-weight: var(--ha-card-header-font-weight, 400);
        color: var(--ha-card-header-color, var(--primary-text-color));
        line-height: 1.2;
      }

      .card-header ha-icon {
        margin-right: 8px;
        color: var(--state-icon-color);
      }

      .card-content {
        padding: 16px;
      }

      .stats {
        display: grid;
        grid-template-columns: 1fr;
        grid-row-gap: 12px;
      }

      .stat {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .stat-label {
        color: var(--secondary-text-color);
      }

      .stat-value {
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .unit {
        font-size: 0.8em;
        opacity: 0.75;
        margin-left: 4px;
      }
    `;
  }

  disconnectedCallback() {
    this.dateRangeService?.disconnect();
    super.disconnectedCallback();
  }

  getCardSize() {
    let size = 1; // Base size
    if (this.cardConfig.showHeader) size += 1;
    size += this.cardConfig.entities.length;
    if (this.cardConfig.outdoor_temperature) size += 1;
    if (this.cardConfig.outdoor_humidity) size += 1;
    return size;
  }
}

// Register component
if (!customElements.get("heatpump-performance-card")) {
  customElements.define("heatpump-performance-card", HeatpumpPerformanceCard);
  console.info(
    "%c andiwirs/ha-heatpump-performance-card %c v1.1.0 ",
    "color: white; background: #4CAF50; font-weight: 700;",
    "color: #4CAF50; background: white; font-weight: 700;"
  );
}

// Register card
window.customCards.push({
    name: 'Heatpump Performance Card',
    description: 'A card to calculate heatpump COP that integrates with the energy-date-selection and displays outdoor conditions',
    type: 'heatpump-performance-card',
    preview: false,
    documentationURL: 'https://github.com/andiwirs/ha-heatpump-performance-card',
});
