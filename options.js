import { init as initViz } from './viz3d.js';
import { init as initSolarViz } from './viz4d.js';

const packetsInCountEl = document.getElementById('packetsInCount');
const packetsOutCountEl = document.getElementById('packetsOutCount');
const totalBytesInEl = document.getElementById('totalBytesIn');
const totalBytesOutEl = document.getElementById('totalBytesOut');
const packetsTableBody = document.querySelector('#packetsTable tbody');

function renderFullUI(data) {
  packetsInCountEl.textContent = data.packetsInCount || 0;
  packetsOutCountEl.textContent = data.packetsOutCount || 0;
  totalBytesInEl.textContent = data.totalBytesIn || 0;
  totalBytesOutEl.textContent = data.totalBytesOut || 0;

  packetsTableBody.innerHTML = '';

  if (data.recentPackets) {
    data.recentPackets.forEach(addPacketToTable);
  }
}

function addPacketToTable(packet, prepend = false) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td title="${packet.url}">${packet.url.length > 80 ? packet.url.substring(0, 80) + '...' : packet.url}</td>
    <td>${packet.method}</td>
    <td>${packet.statusCode}</td>
    <td>${packet.type}</td>
    <td>${new Date(packet.timeStamp).toLocaleString()}</td>
  `;
  if (prepend) {
    packetsTableBody.prepend(row);
  } else {
    packetsTableBody.appendChild(row);
  }
}

let allTrafficHistory = [];

// Initial load
chrome.storage.local.get(['packetsInCount', 'packetsOutCount', 'totalBytesIn', 'totalBytesOut', 'recentPackets', 'trafficHistory'], (result) => {
  renderFullUI(result);
  allTrafficHistory = result.trafficHistory || [];
  updateChartData();
});

// Listen for changes and perform efficient updates
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  if (changes.packetsInCount) {
    packetsInCountEl.textContent = changes.packetsInCount.newValue || 0;
  }
  if (changes.packetsOutCount) {
    packetsOutCountEl.textContent = changes.packetsOutCount.newValue || 0;
  }
  if (changes.totalBytesIn) {
    totalBytesInEl.textContent = changes.totalBytesIn.newValue || 0;
  }
  if (changes.totalBytesOut) {
    totalBytesOutEl.textContent = changes.totalBytesOut.newValue || 0;
  }
  if (changes.recentPackets) {
    const newPacket = changes.recentPackets.newValue[0];
    addPacketToTable(newPacket, true); // Prepend the new packet
    
    // Keep the table size at 30
    while (packetsTableBody.rows.length > 30) {
      packetsTableBody.deleteRow(-1); // Remove the last row
    }
  }
  if (changes.trafficHistory) {
    allTrafficHistory = changes.trafficHistory.newValue || [];
    updateChartData();
  }
});

document.getElementById('timeWindow').addEventListener('change', () => {
  updateChartData();
});

// Tab switching logic
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab;

    // Activate the selected tab first so sizes are measurable
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tab}Content`).classList.add('active');

    // Initialize the appropriate view when visible
    if (tab === 'map') {
      initViz();
    } else if (tab === 'solar') {
      initSolarViz();
    }
  });
});

// Lightweight SVG Chart Implementation
const trafficChart = document.getElementById('trafficChart');
const chartLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
chartLine.setAttribute('class', 'chart-line');
trafficChart.appendChild(chartLine);

let chartData = [];

function updateChartData() {
  const timeWindow = document.getElementById('timeWindow').value;
  const now = Date.now();
  let startTime = 0;

  if (timeWindow === 'minute') {
    startTime = now - 60 * 1000;
  } else if (timeWindow === 'hour') {
    startTime = now - 60 * 60 * 1000;
  }

  chartData = allTrafficHistory.filter(point => point.time >= startTime);
  drawChart();
}

function drawChart() {
  if (chartData.length < 2) {
    chartLine.setAttribute('d', '');
    return;
  }

  const width = trafficChart.clientWidth;
  const height = trafficChart.clientHeight;
  const firstPoint = chartData[0];
  const lastPoint = chartData[chartData.length - 1];
  const minTime = firstPoint.time;
  const maxTime = lastPoint.time;
  const timeRange = maxTime - minTime;

  let minVal = Infinity, maxVal = -Infinity;
  for (const point of chartData) {
    if (point.value < minVal) minVal = point.value;
    if (point.value > maxVal) maxVal = point.value;
  }

  const valRange = maxVal - minVal;
  const pathData = chartData.map((point, i) => {
    const x = timeRange > 0 ? (point.time - minTime) / timeRange * width : width / 2;
    const y = valRange > 0 ? height - ((point.value - minVal) / valRange * height) : height / 2;
    return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
  }).join(' ');

  chartLine.setAttribute('d', pathData);
}
