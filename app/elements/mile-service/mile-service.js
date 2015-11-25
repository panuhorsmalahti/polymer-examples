define('mile-service', {
    kilometersToMiles: function(km) {
        return Math.round(0.621371192 * km * 10) / 10.0;
    }
});
