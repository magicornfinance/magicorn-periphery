mkdir contracts/.flattened
npx truffle-flattener contracts/MagicornSwapRouter.sol > contracts/.flattened/MagicornSwapRouter.sol
npx truffle-flattener contracts/libraries/MagicornSwapLibrary.sol > contracts/.flattened/MagicornSwapLibrary.sol
npx truffle-flattener contracts/libraries/MagicornSwapOracleLibrary.sol > contracts/.flattened/MagicornSwapOracleLibrary.sol
