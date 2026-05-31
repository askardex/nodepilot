const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const devnetSvNodes = [
  { name: 'C7 Technology Services Limited', url: 'https://scan.sv-1.dev.global.canton.network.c7.digital', version: '0.6.2' },
  { name: 'Cumberland 1', url: 'https://scan.sv-1.dev.global.canton.network.cumberland.io', version: '0.6.2' },
  { name: 'Cumberland 2', url: 'https://scan.sv-2.dev.global.canton.network.cumberland.io', version: '0.6.2' },
  { name: 'DA Helm Test Node', url: 'https://scan.sv.dev.global.canton.network.digitalasset.com', version: '0.6.2' },
  { name: 'Digital Asset 1', url: 'https://scan.sv-1.dev.global.canton.network.digitalasset.com', version: '0.6.2' },
  { name: 'Digital Asset 2', url: 'https://scan.sv-2.dev.global.canton.network.digitalasset.com', version: '0.6.2' },
  { name: 'Five North 1', url: 'https://scan.sv-1.dev.global.canton.network.fivenorth.io', version: '0.6.2' },
  { name: 'Global Synchronizer Foundation', url: 'https://scan.sv-1.dev.global.canton.network.sync.global', version: '0.6.2' },
  { name: 'Liberty City Ventures 1', url: 'https://scan.sv-1.dev.global.canton.network.lcv.mpch.io', version: '0.6.2' },
  { name: 'Orb1 LP 1', url: 'https://scan.sv-1.dev.global.canton.network.orb1lp.mpch.io', version: '0.6.2' },
  { name: 'Proof Group 1', url: 'https://scan.sv-1.dev.global.canton.network.proofgroup.xyz', version: '0.6.1' },
  { name: 'SV Nodeops Limited', url: 'https://scan.sv.dev.global.canton.network.sv-nodeops.com', version: '0.6.1' },
  { name: 'Tradeweb Markets 1', url: 'https://scan.sv-1.dev.global.canton.network.tradeweb.com', version: '0.6.2' }
]

async function main() {
  // Clear existing
  await prisma.svScanNode.deleteMany({ where: { network: 'DevNet' } })

  // Seed DevNet nodes
  for (const node of devnetSvNodes) {
    await prisma.svScanNode.create({
      data: { ...node, network: 'DevNet' }
    })
  }

  console.log(`Seeded ${devnetSvNodes.length} DevNet SV scan nodes`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1) })
