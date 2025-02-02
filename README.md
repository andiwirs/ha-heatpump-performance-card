# Home Assistant Heatpump Performance Card

A custom Home Assistant card that displays heat pump performance by reading two sensor entities (electrical and thermal energy) and calculating the coefficient of performance (COP). 
The card listens for date range selections provided by an energy-date-selection card and fetches historical data from Home Assistant's Data Recoder or Statistics. 

![Heatpump Performance Example](cards.jpg)

## Basic Setup

Ensure that an `energy-date-selection` card is added to your page.
You can add it as a manual card via the "Add Card" menu with the following content:
```
type: energy-date-selection
```
You can then add one or more custom heatpump-performance-card cards to your dashboard. 

Here’s a full example YAML configuration for the card:
```
type: custom:heatpump-performance-card
name: Heatpump Performance
cop_name: Performance (COP) # Optional: Configure the label for the COP row (defaults to "COP")
entities:
  - entity: sensor.electrical_energy
    name: Electrical Energy
  - entity: sensor.thermal_energy
    name: Thermal Energy
```

In this example, the card will display the two sensor values and calculate the Performance (COP) based on the retrieved data.

## Installation

#### HACS
1. Navigate to your home assistants HACS tab and open the "Frontend" section
2. Click the 3 dot menu in the top right hand corner.
3. Select "Custom repositories"
4. Enter `andiwirs/ha-heatpump-performance-card` as the repository and `Dashboard` as the category.
5. Press "Add"
6. The `heatpump-performance-card` should now be available in HACS. Install it and refresh your browser.

See the [HACS Custom Repository](https://hacs.xyz/docs/faq/custom_repositories/) page for full details.

#### Manual
1. Copy `heatpump-performance-card.js` to your `/hass/www` folder.
2. Click on `Edit Dashboard`, `Manage resources` add `/local/heatpump-performance-card.js` as `JavaScript Module`.