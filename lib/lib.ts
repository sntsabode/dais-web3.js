import { colors, log, makeDir, makeFile } from './utils'
import { resolve as pathResolve } from 'path'
import { DaisConfig } from './files/daisconfig'
import { IContractImport, IDaisConfig, SupportedNetwork, SupportedProtocol, SupportedProtocolsArray } from './daisconfig'
import fs from 'fs'
import { BancorWriter } from './protocols/bancor'
import { DyDxWriter } from './protocols/dydx'
import { IABIReturn, IWriterReturn } from './protocols/__imports__'

type ProtocolFileWriterAddresses = {
  [protocol in SupportedProtocol]: {
    [net in SupportedNetwork]: {
      ContractName: string
      Address: string
    }[]
  } 
} & {
  ERROR: {
    [net in SupportedNetwork]: {
      ContractName: string
      Address: string
    }[]
  }
}

class ProtocolFileWriter {
  static readonly instance = new ProtocolFileWriter()
  private constructor ( ) { /**/ }

  /**
   * Flags to make sure the same directory isn't tried to be 
   * made more than once
   */
  readonly #madeDirs: {
    [protocol in SupportedProtocol]: boolean
  } = (function () {
    const protocolObject = <{ 
      [protocol in SupportedProtocol]: boolean 
    }>{}
    for (const protocol of SupportedProtocolsArray)
      protocolObject[protocol] = false
    return protocolObject
  })()

  /**
   * An object of arrays holding the addresses for the contracts
   * written. These addresses are the addresses going to be written
   * in the `/lib/addresses.ts` file
   */
  readonly #addresses: ProtocolFileWriterAddresses = (function () {
    const obj: ProtocolFileWriterAddresses = <unknown>{} as ProtocolFileWriterAddresses
    for (const protocol of SupportedProtocolsArray)
      obj[protocol] = {
        MAINNET: [], KOVAN: [], ROPSTEN: []
      }
    obj['ERROR'] = {
      MAINNET: [], KOVAN: [], ROPSTEN: []
    }

    return obj
  })()

  readonly #abis: {
    [protocol in SupportedProtocol]: IABIReturn[]
  } & {
    ERROR: IABIReturn[]
  } = (function () {
    const obj = <
      { [protocol in SupportedProtocol]: IABIReturn[] } &
      { ERROR: IABIReturn[] }
    >{}

    for (const protocol of SupportedProtocolsArray)
      obj[protocol] = []
    obj.ERROR = []
    return obj
  })()

  /**
   * Main contract writer entry point
   * @param dir 
   * @param contractImports 
   * @param solver 
   * @param net 
   * @returns An array of dependencies meant to be installed,
   * declared in the `contractImports` section of the `.daisconfig`
   * file
   */
  readonly main = async (
    dir: string,
    contractImports: IContractImport[],
    solver: string,
    net: SupportedNetwork | 'all'
  ): Promise<string[]> => makeBaseDirs(dir)
    .then(() => this.#work(
    solver, contractImports, dir, net
  ), e => { throw e }).then(
    (val) => Promise.all([
      this.#buildABIFile(dir),
      this.#buildAddressesFile(dir)
    ]).then(
      () => [...new Set(val)],
      e => { throw e }
    ),

    e => { throw e }
  )

  readonly #work = async (
    solver: string,
    contractImports: IContractImport[],
    dir: string,
    net: SupportedNetwork | 'all'
  ): Promise<string[]> => Promise.all(contractImports.map(
    ci => {
      let protocol = <SupportedProtocol | 'ERROR'>ci.protocol.toUpperCase()
      protocol = !this.protocols[protocol] ? 'ERROR' : protocol
      return this.protocols[protocol](
        dir, solver, net, ci
      ).then(val => {
        this.#abis[protocol].push(
          ...val.ABIs
        )
  
        val.Addresses.forEach(address => {
          this.#addresses[protocol][address.NET].push({
            ContractName: address.ContractName,
            Address: address.Address
          })
        })
  
        return val.Pack
      }, e => { throw e })
    }
  ))

  readonly #buildABIFile = async (
    dir: string
  ) => {
    let ABIfile = ''
    for (const [protocol, abis] of Object.entries(this.#abis)) {
      if (
        abis.length === 0
        || protocol === 'ERROR'
      ) continue
      
      ABIfile += `\nexport const ${protocol}_ABI = {`
      for (const abi of abis)
        ABIfile += '\n  ' + abi.ABI + ','

      ABIfile += '\n}'
    }

    return makeFile(pathResolve(dir + '/lib/abis.ts'), ABIfile.trim())
      .catch(e => { throw e })
  }

  readonly #buildAddressesFile = async (
    dir: string
  ) => {
    let AddressesFile = 'export const Addresses = {'
    for (const [protocol, networks] of Object.entries(this.#addresses)) {
      if (protocol === 'ERROR') continue
      if (
        this.#addresses[<SupportedProtocol>protocol].MAINNET.length === 0
        && this.#addresses[<SupportedProtocol>protocol].KOVAN.length === 0
        && this.#addresses[<SupportedProtocol>protocol].ROPSTEN.length === 0
      ) continue

      AddressesFile += `\n  ${protocol}: {`

      for (const [net, addresses] of Object.entries(networks)) {
        if (addresses.length === 0) continue
        AddressesFile += `\n    ${net}: {`

        for (const address of addresses) {
          AddressesFile += `\n      ${address.ContractName}: ${address.Address},`
        }

        AddressesFile += `\n    },`
      }

      AddressesFile += `\n  },\n`
    }

    AddressesFile += '\n}'

    return makeFile(pathResolve(
      dir + '/lib/addresses.ts'
    ), AddressesFile.trim())
  }

  readonly #bancor = async (
    dir: string,
    solver: string,
    net: SupportedNetwork | 'all',
    ci: IContractImport
  ): Promise<IWriterReturn> => {
    // Is promise.all because the libraries dir can also be made
    // here when it's needed
    if (!this.#madeDirs.BANCOR) await Promise.all([
      makeDir(pathResolve(dir + '/contracts/interfaces/Bancor'))
    ]).then(
      () => this.#madeDirs.BANCOR = true,
      e => { throw e }
    )

    return BancorWriter(dir, solver, net, ci)
      .catch(e => { throw e })
  }

  readonly #dydx = async (
    dir: string,
    solver: string,
    net: SupportedNetwork | 'all',
    ci: IContractImport
  ): Promise<IWriterReturn> => {
    if (!this.#madeDirs.DYDX) await Promise.all([
      makeDir(pathResolve(dir + '/contracts/interfaces/DyDx')),
      makeDir(pathResolve(dir + '/contracts/libraries/DyDx'))
    ]).then(
      () => this.#madeDirs.DYDX = true,
      e => { throw e }
    )

    return DyDxWriter(dir, solver, net, ci)
      .catch(e => { throw e })
  }

  readonly protocols: {
    readonly [protocol in SupportedProtocol]: (
      dir: string,
      solver: string,
      net: SupportedNetwork | 'all',
      ci: IContractImport
    ) => Promise<IWriterReturn>
  } & {
    readonly ERROR: (
      dir: string, solver: string, 
      net: SupportedNetwork | 'all',
      ci: IContractImport
    ) => Promise<IWriterReturn>
  }= {
    BANCOR: this.#bancor,
    DYDX: this.#dydx,
    KYBER: async (dir, solver, ci) => ({
      ABIs: [], Addresses: [], Pack: ''
    }),
    ONEINCH: async (dir, solver, ci) => ({
      ABIs: [], Addresses: [], Pack: ''
    }),
    UNISWAP: async (dir, solver, ci) => ({
      ABIs: [], Addresses: [], Pack: ''
    }),
    ERROR: async (d,s,n, ci) => {
      log.error('---', ...colors.red(ci.protocol), 'is not a supported protocol')
      return {
        ABIs: [], Addresses: [], Pack: ''
      }
    }
  }
}

const makeBaseDirs = async (
  dir: string
): Promise<void[]> => Promise.all([
  makeDir(pathResolve(dir + '/contracts/interfaces')),
  makeDir(pathResolve(dir + '/contracts/libraries')),
  makeDir(pathResolve(dir + '/lib')),
  makeDir(pathResolve(dir + '/migrations'))
]).catch(e => { throw e })

export async function Assemble(dir: string): Promise<void> {
  const daisconfig = await fetchdaisconfig(dir)
    .catch(e => { throw e })
  
  const contractDeps = await ProtocolFileWriter.instance.main(
    dir, 
    daisconfig.contractImports, 
    daisconfig.solversion,
    daisconfig.defaultNet
  )

  log(contractDeps)
}

export async function Init(dir: string): Promise<void> {
  return makeFile(pathResolve(dir + '/.daisconfig'), DaisConfig)
}

async function fetchdaisconfig(dir: string): Promise<IDaisConfig> {
  return JSON.parse(
    fs.readFileSync(pathResolve(dir + '/.daisconfig')).toString()
  )
}