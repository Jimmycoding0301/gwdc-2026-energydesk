import { createApp } from './app';
const registryAddress = process.env.NILE_RECEIPT_REGISTRY_ADDRESS || process.env.TRON_RECEIPT_REGISTRY_ADDRESS;
createApp({ registryAddress }).listen(8789, '127.0.0.1', () => console.log(`EnergyDesk API http://127.0.0.1:8789 · public quotes + ${registryAddress ? 'Nile receipt registry' : 'Nile receipt registry not configured'}`));
