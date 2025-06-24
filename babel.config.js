// Disable Babel completely for Jest - use ts-jest instead
module.exports = function (api) {
  // Cache the config for performance
  api.cache(true);
  
  // Return empty config to disable babel transformation
  return {
    // No presets or plugins - disable all Babel transformation
    ignore: [
      '**/*' // Ignore all files - let Jest handle with ts-jest
    ]
  };
};