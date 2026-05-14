sap.ui.define([
    'jquery.sap.global',
	"sap/dm/dme/podfoundation/controller/PluginViewController",
	"sap/ui/model/json/JSONModel",
    "./Utils/Commons",
    "./Utils/ApiPaths",
    "../model/formatter",
    "sap/ui/core/Element",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Button",
    "sap/ui/core/library"
], function (jQuery, PluginViewController, JSONModel, Commons, ApiPaths, formatter, Element, MessageBox, Dialog, Input, Button, coreLibrary) {
	"use strict";
    var gOperationPhase = {};
    const OPERATION_STATUS = { ACTIVE: "ACTIVE", QUEUED: "IN_QUEUE" }

	return PluginViewController.extend("serviacero.custom.plugins.zpluginPutBatchWCEF02.zpluginPutBatchWCEF02.controller.MainView", {
        Commons: Commons,
        ApiPaths: ApiPaths,
        formatter: formatter,

        onInit: function () {
            PluginViewController.prototype.onInit.apply(this, arguments);
            this.oScanInput = this.byId("scanInput");
            this._suggestedQtyCintas = 0;
        },

        /**
         * Helper: devuelve la key activa del SegmentedButton ("CINTAS" o "ALAMBRE")
         */
        _getActiveKey: function () {
            return (this.getView().byId("tableToggle").getSelectedKey()) || "CINTAS";
        },

        /**
         * Helper: devuelve el control Table activo según el SegmentedButton
         */
        _getActiveTable: function () {
            var oView = this.getView();
            return this._getActiveKey() === "CINTAS"
                ? oView.byId("idSlotTableCintas")
                : oView.byId("idSlotTableAlambre");
        },

        /**
         * Handler del SegmentedButton: muestra/oculta las dos tablas
         */
        onToggleTable: function () {
            var oView = this.getView();
            var sKey = oView.byId("tableToggle").getSelectedKey();
            var bCintas = sKey === "CINTAS";
            oView.byId("containerCintas").setVisible(bCintas);
            oView.byId("containerAlambre").setVisible(!bCintas);
            // Sync slotQty display for active table
            var sQty = bCintas
                ? oView.byId("slotQty_cintas").getValue()
                : oView.byId("slotQty_alambre").getValue();
            oView.byId("slotQty").setValue(sQty);
            this._updateProgressIndicator();
        },

        /**
         * Stub para agregar cantidad asignada por fila (feature pendiente)
         */
        onAddQty: function (oEvent) {
            // Feature de cantidad asignada - pendiente de implementación
        },

        onAfterRendering: function () {
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
        },
        _getCurrentOperationStatus: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            var sCurrentStatus = "";

            
            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                sCurrentStatus = oPodSelectionModel.selectedPhaseData.status || "";
            }

            if (!sCurrentStatus) {
                var operation = (oPodSelectionModel && typeof oPodSelectionModel.getOperation === "function")
                    ? (oPodSelectionModel.getOperation() && oPodSelectionModel.getOperation().operation)
                    : null;
                if (!operation && gOperationPhase && gOperationPhase.operation) {
                    operation = gOperationPhase.operation.operation || gOperationPhase.operation;
                }
                if (operation) {
                    sCurrentStatus = operation.status || operation.operationStatus || "";
                }
            }

            if (!sCurrentStatus && gOperationPhase) {
                sCurrentStatus = gOperationPhase.status || "";
            }

            return sCurrentStatus;
        },
        onGetCustomValues: function () {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            this.ajaxGetRequest(oSapApi + this.ApiPaths.WORKCENTERS, oParams, function (oRes) {
                var oData = Array.isArray(oRes) ? oRes[0] : oRes;
                if (!oData || !oData.customValues) {
                    console.error("No se encontraron customValues en la respuesta");
                    return;
                }

                var aCustomValues = oData.customValues;
                var noCargaSlot = aCustomValues.find(function (el) { return el.attribute === "NO_CARGA"; }) || { value: "0" };
                var tipoSlot = aCustomValues.find(function (el) { return el.attribute === "SLOTTIPO"; }) || { value: "" };
                var cvQtyCin = aCustomValues.find(function (el) { return el.attribute === "SLOTQTY_CIN"; }) || { value: "0" };
                var cvQtyAlm = aCustomValues.find(function (el) { return el.attribute === "SLOTQTY_ALM"; }) || { value: "0" };
                var iQtyCin = parseInt(cvQtyCin.value || "0", 10);
                var iQtyAlm = parseInt(cvQtyAlm.value || "0", 10);
                var iTotalSlots = iQtyCin + iQtyAlm;

                // Obtener pool de slots (atributos SLOT###)
                var aAllSlots = aCustomValues.filter(function (item) {
                    return item.attribute.startsWith("SLOT") &&
                        item.attribute !== "SLOTQTY_CIN" &&
                        item.attribute !== "SLOTQTY_ALM" &&
                        item.attribute !== "SLOTTIPO";
                });

                // Normalizar: recortar o rellenar hasta iTotalSlots
                var aSlotsFixed = aAllSlots.slice();
                if (aSlotsFixed.length > iTotalSlots && iTotalSlots > 0) {
                    aSlotsFixed = aSlotsFixed.slice(0, iTotalSlots);
                }
                for (var i = aSlotsFixed.length + 1; i <= iTotalSlots; i++) {
                    aSlotsFixed.push({ attribute: "SLOT" + i.toString().padStart(3, "0"), value: "" });
                }

                // Repartir: primeros iQtyCin → cintas, siguientes iQtyAlm → alambre
                var aSlotsCin = aSlotsFixed.slice(0, iQtyCin);
                var aSlotsAlm = aSlotsFixed.slice(iQtyCin, iQtyCin + iQtyAlm);

                var oTableCin = oView.byId("idSlotTableCintas");
                var oTableAlm = oView.byId("idSlotTableAlambre");
                if (oTableCin) { oTableCin.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsCin })); }
                if (oTableAlm) { oTableAlm.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsAlm })); }

                // Actualizar inputs
                oView.byId("noCarga").setValue(noCargaSlot.value || "0");
                oView.byId("slotType").setValue(tipoSlot.value || "");
                oView.byId("slotQty_cintas").setValue(iQtyCin.toString());
                oView.byId("slotQty_alambre").setValue(iQtyAlm.toString());

                // slotQty visible muestra la cantidad de la tabla activa
                var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
                oView.byId("slotQty").setValue(sActiveKey === "CINTAS" ? iQtyCin.toString() : iQtyAlm.toString());

                this._updateProgressIndicator();
            }.bind(this));
        },
        /**
         * Refresca los slots desde backend, preservando cantidadAsignada/loteQty/loteUom del modelo actual.
         * Devuelve promesa con { slots, slotsCin, slotsAlm, allSlots, customValues, iQtyCin, iQtyAlm }
         */
        _refreshSlotsFromBackend: function () {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var sParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            // Preservar loteQty, loteUom y cantidadAsignada del modelo actual (ambas tablas)
            var aCurrentCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aCurrentAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var oLoteQtyMap = {};
            var oLoteUomMap = {};
            var oCantidadAsignadaMap = {};
            [].concat(aCurrentCin, aCurrentAlm).forEach(function (item) {
                if (item.value) {
                    var parts = item.value.split('!');
                    var key = parts.slice(0, 2).join('!').toUpperCase();
                    oLoteQtyMap[key] = item.loteQty || "";
                    oLoteUomMap[key] = item.loteUom || "";
                    oCantidadAsignadaMap[key] = item.cantidadAsignada || "";
                }
            });

            return this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oData) {
                if (!oData || oData === "Error" || !oData.customValues) {
                    return null;
                }

                var aCustomValues = oData.customValues;
                var cvQtyCin = aCustomValues.find(function (el) { return el.attribute === "SLOTQTY_CIN"; }) || { value: "0" };
                var cvQtyAlm = aCustomValues.find(function (el) { return el.attribute === "SLOTQTY_ALM"; }) || { value: "0" };
                var iQtyCin = parseInt(cvQtyCin.value || "0", 10);
                var iQtyAlm = parseInt(cvQtyAlm.value || "0", 10);
                var iTotalSlots = iQtyCin + iQtyAlm;

                var aAllSlots = aCustomValues.filter(function (item) {
                    return item.attribute.startsWith("SLOT") &&
                        item.attribute !== "SLOTQTY_CIN" &&
                        item.attribute !== "SLOTQTY_ALM" &&
                        item.attribute !== "SLOTTIPO";
                });

                var aSlotsFixed = aAllSlots.slice();
                if (aSlotsFixed.length > iTotalSlots && iTotalSlots > 0) {
                    aSlotsFixed = aSlotsFixed.slice(0, iTotalSlots);
                }
                for (var i = aSlotsFixed.length + 1; i <= iTotalSlots; i++) {
                    aSlotsFixed.push({ attribute: "SLOT" + i.toString().padStart(3, "0"), value: "" });
                }

                // Restaurar campos del modelo anterior
                aSlotsFixed.forEach(function (slot) {
                    if (slot.value) {
                        var parts = slot.value.split('!');
                        var key = parts.slice(0, 2).join('!').toUpperCase();
                        slot.loteQty = oLoteQtyMap[key] || "";
                        slot.loteUom = oLoteUomMap[key] || "";
                        slot.cantidadAsignada = (parts.length >= 4 ? parts[2] : "") || oCantidadAsignadaMap[key] || "";
                    } else {
                        slot.loteQty = "";
                        slot.loteUom = "";
                        slot.cantidadAsignada = "";
                    }
                });

                // Repartir entre tablas
                var aSlotsCin = aSlotsFixed.slice(0, iQtyCin);
                var aSlotsAlm = aSlotsFixed.slice(iQtyCin, iQtyCin + iQtyAlm);

                if (oTableCin) { oTableCin.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsCin })); }
                if (oTableAlm) { oTableAlm.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsAlm })); }

                // Resincronizar contador de secuencia
                var aSlotsConValor = aSlotsFixed.filter(function (s) { return s.value && s.value.trim() !== ""; });
                if (aSlotsConValor.length === 0) {
                    this.iSecuenciaCounter = 0;
                } else {
                    this.iSecuenciaCounter = Math.max.apply(null, aSlotsConValor.map(function (s) {
                        var p = (s.value || "").split('!');
                        return parseInt((p.length >= 4 ? p[3] : p[2]) || 0, 10);
                    }));
                }

                var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
                return {
                    slots: sActiveKey === "CINTAS" ? aSlotsCin : aSlotsAlm,
                    slotsCin: aSlotsCin,
                    slotsAlm: aSlotsAlm,
                    allSlots: aSlotsFixed,
                    customValues: aCustomValues,
                    iQtyCin: iQtyCin,
                    iQtyAlm: iQtyAlm
                };
            }.bind(this));
        },
        /**
        * Botón "Iniciar Carga":
        *  - CINTAS: cantidad tomada automáticamente de la característica de orden (CT_100035_500 / CT_100038_500), sin diálogo.
        *  - ALAMBRE: el operador ingresa la cantidad en un diálogo.
        * @returns {void}
        */
        onInicioEscaneo: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var sActiveKey = this._getActiveKey();
            var self = this;

            var sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"));
                return;
            }

            // Validar que la tabla activa esté completa antes de iniciar nueva carga
            var oTable = this._getActiveTable();
            var oModel = oTable.getModel();
            var aItems = oModel ? oModel.getProperty("/ITEMS") : [];
            var sQtyId = sActiveKey === "CINTAS" ? "slotQty_cintas" : "slotQty_alambre";
            var iSlotQty = parseInt(oView.byId(sQtyId).getValue() || "0", 10);
            var iEscaneados = aItems.filter(function (slot) { return slot.value && slot.value.trim() !== ""; }).length;

            if (iSlotQty > 0 && iEscaneados < iSlotQty) {
                var iFaltantes = iSlotQty - iEscaneados;
                sap.m.MessageBox.warning(
                    oBundle.getText("cargaIncompleta", [iEscaneados, iSlotQty, iFaltantes]),
                    { title: oBundle.getText("cargaIncompletaTitle") }
                );
                return;
            }

            if (sActiveKey === "CINTAS") {
                // --- Cintas: usar cantidad de la característica de orden directamente ---
                if (!this._suggestedQtyCintas || this._suggestedQtyCintas <= 0) {
                    sap.m.MessageBox.warning(
                        oBundle.getText("sinCantidadSugerida"),
                        { title: oBundle.getText("sinCantidadSugeridaTitle") }
                    );
                    return;
                }
                this._iniciarNuevaCarga(this._suggestedQtyCintas, "CINTAS");

            } else {
                // --- Alambre: el operador ingresa la cantidad ---
                var oQuantityInput = new Input({
                    type: "Number",
                    value: "",
                    placeholder: oBundle.getText("cantidadPlaceholder") || "Ej: 35",
                    liveChange: function (oEvent) {
                        var iValue = parseInt(oEvent.getSource().getValue(), 10);
                        oOkButton.setEnabled(iValue > 0);
                    }
                });

                var oOkButton = new Button({
                    text: oBundle.getText("okButton") || "OK",
                    enabled: false,
                    press: function () {
                        var iCantidad = parseInt(oQuantityInput.getValue(), 10);
                        if (iCantidad > 0) {
                            oDialog.close();
                            self._iniciarNuevaCarga(iCantidad, "ALAMBRE");
                        } else {
                            sap.m.MessageToast.show(oBundle.getText("cantidadInvalida"));
                        }
                    }
                });

                var oCancelButton = new Button({
                    text: oBundle.getText("cancelButton") || "Cancelar",
                    type: "Reject",
                    press: function () { oDialog.close(); }
                });

                var oDialog = new Dialog({
                    title: oBundle.getText("iniciarCargaAlambreTitle") || "Iniciar Carga - Alambre",
                    content: [oQuantityInput],
                    buttons: [oOkButton, oCancelButton],
                    afterClose: function () { oDialog.destroy(); }
                });

                oDialog.open();
                oQuantityInput.focus();
            }
        },
        /**
        * Finalizar carga: ajustar SLOTQTY_CIN/ALM al número real escaneado en ambas tablas
        * @returns {void}
        */
        onFinalizarCarga: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;

            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aItemsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var iTotalQty = iQtyCin + iQtyAlm;

            var iEscaneadosCin = aItemsCin.filter(function (s) { return s.value && s.value.trim(); }).length;
            var iEscaneadosAlm = aItemsAlm.filter(function (s) { return s.value && s.value.trim(); }).length;
            var iEscaneados = iEscaneadosCin + iEscaneadosAlm;
            var sNoCarga = oView.byId("noCarga").getValue() || "0";

            if (iTotalQty <= 0) {
                sap.m.MessageToast.show(oBundle.getText("finalizarCargaSinCarga"));
                return;
            }
            if (iEscaneados === 0) {
                sap.m.MessageBox.warning(
                    oBundle.getText("finalizarCargaSinLotes"),
                    { title: oBundle.getText("finalizarCargaTitulo") }
                );
                return;
            }

            oView.byId("idPluginPanel").setBusy(true);
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oCurrentRes) {
                var aCurrentCV = self._getValidatedCustomValues(oCurrentRes, oBundle);
                if (!aCurrentCV) { oView.byId("idPluginPanel").setBusy(false); return; }

                var aEdited = [
                    { attribute: "SLOTQTY_CIN", value: iEscaneadosCin.toString() },
                    { attribute: "SLOTQTY_ALM", value: iEscaneadosAlm.toString() }
                ];
                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });

                var aFinal = aCurrentCV.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    oView.byId("slotQty_cintas").setValue(iEscaneadosCin.toString());
                    oView.byId("slotQty_alambre").setValue(iEscaneadosAlm.toString());
                    self._updateProgressIndicator();
                    sap.m.MessageBox.success(
                        oBundle.getText("finalizarCargaMensaje", [sNoCarga, iEscaneados, iTotalQty]),
                        { title: oBundle.getText("finalizarCargaTitulo") }
                    );
                    setTimeout(function () { self.onGetCustomValues(); }, 500);
                }).catch(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorFinalizarCarga"));
                });
            }).catch(function () {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },
        onBarcodeSubmit: function () {
            const oView = this.getView();
            const oInput = oView.byId("scanInput");
            const sBarcode = oInput.getValue().trim();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (!sBarcode) {
                return;
            }

            // Usar la tabla activa según el SegmentedButton
            var oTable = this._getActiveTable();
            var oModel = oTable.getModel();
            var aItems = oModel ? (oModel.getProperty("/ITEMS") || []) : [];

            var sNormalizado = sBarcode.toUpperCase();
            var partsBarcode = sNormalizado.split('!');

            if (partsBarcode.length < 2 || !partsBarcode[0] || !partsBarcode[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                oInput.setValue(""); oInput.focus();
                return;
            }
            var loteExtraido = partsBarcode[1].trim();
            var materialExtraido = partsBarcode[0].trim();

            this._validarMaterialYLote(loteExtraido, materialExtraido);
        },
        /**
        * Funcion del boton "clear" con fragmento de confirmacion para limpiar la tabla y actualizar los customValues  
        * @returns {string} - funcion clearModel
        */
        onPressClear: function () {
            const oView = this.getView(),
                oResBun = oView.getModel("i18n").getResourceBundle();
            this.Commons.showConfirmDialog(function () {
                this.clearModel();
            }.bind(this), null, oResBun.getText("clearWarningMessage"));
        },
        clearModel: function () {
            var oView = this.getView();
            var sActiveKey = this._getActiveKey();
            var oTable = this._getActiveTable();
            var oScanInput = oView.byId("scanInput");
            var oModel = oTable.getModel();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;

            var aItems = oModel ? (oModel.getProperty("/ITEMS") || []) : [];
            if (aItems.length === 0) {
                sap.m.MessageToast.show(oBundle.getText("noDataToClear"));
                return;
            }

            // Vaciar valores manteniendo los atributos
            aItems.forEach(function (item) {
                item.value = "";
                item.loteQty = "";
                item.loteUom = "";
            });
            oModel.setProperty("/ITEMS", aItems);
            oModel.refresh(true);
            oScanInput.setValue("");
            oScanInput.focus();
            this._updateProgressIndicator();

            // Construir pool completo con ambas tablas para el update
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);

            var slotTipo = oView.byId("slotType").getValue();
            // Resetear la cantidad de la tabla activa a 0; la otra tabla mantiene su cantidad
            var iQtyCin = sActiveKey === "CINTAS" ? 0 : parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = sActiveKey === "ALAMBRE" ? 0 : parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);

            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY_CIN", value: iQtyCin.toString() },
                { attribute: "SLOTQTY_ALM", value: iQtyAlm.toString() },
                { attribute: "NO_CARGA", value: "0" }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { self.onGetCustomValues(); return; }

                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });

                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({
                    inCustomValues: aFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("dataClearedSuccess"));
                    setTimeout(function () { self.onGetCustomValues(); }, 500);
                }).catch(function () {
                    sap.m.MessageToast.show(oBundle.getText("errorClearing"));
                    self.onGetCustomValues();
                });
            }).catch(function () {
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },
        /**
        * Llamada al Pp(getReservas) para obtener los lotes en Reserva y hacer validacion de material
        * @param {string} sLote - Valor del lote "material!lote" 
        * @param {string} sMaterial - Valor del material "material!lote" 
        * @returns {string} - Solo el material
        */
        _validarMaterialYLote: function (sLote, sMaterial) {
            const oView = this.getView();
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            const mandante = this.getConfiguration().mandante;
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            const oInput = oView.byId("scanInput");
            const loteEscaneado = sLote;
            const materialEscaneado = sMaterial;

            const sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"))
                return;
            }

            // validacion de material PRIMERO SE HACE LA DEL MATERIAL
            const urlMaterial = this.getPublicApiRestDataSourceUri() + this.ApiPaths.validateMaterialEnOrden;
            var inParamsMaterial = {
                "inPlanta": oPODParams.PLANT_ID,
                "inLote": loteEscaneado,
                "inOrden": oPODParams.ORDER_ID,
                "inMaterial": materialEscaneado
            };
            oView.byId("idPluginPanel").setBusy(true);

            this.ajaxPostRequest(urlMaterial, inParamsMaterial,
                // SUCCESS callback de validación de material
                function (oResMat) {
                    console.log("Respuesta material:", oResMat);
                    const matOk = oResMat && (oResMat.outMaterial === true || oResMat.outMaterial === "true");
                    const msgMat = (oResMat && oResMat.outMensaje) || oBundle.getText("materialNoValido");

                    if (!matOk) {
                        oView.byId("idPluginPanel").setBusy(false);
                        sap.m.MessageToast.show(msgMat);
                        oInput.setValue("");
                        oInput.focus();
                        this._slotContext = null;
                        return;
                    }

                    //Validacion de lotes  DESPUES DE LA DEL MATERIAL
                    var urlLote = this.getPublicApiRestDataSourceUri() + this.ApiPaths.getReservas;
                    var inParamsLote = {
                        "inPlanta": oPODParams.PLANT_ID,
                        "inLote": loteEscaneado,
                        "inOrden": oPODParams.ORDER_ID,
                        "inSapClient": mandante,
                        "inMaterial": materialEscaneado,
                        "inPuesto": oPODParams.WORK_CENTER
                    };

                    this.ajaxPostRequest(urlLote, inParamsLote,
                        // SUCCESS callback de validación de lote
                        function (oResponseData) {
                            oView.byId("idPluginPanel").setBusy(false);
                            console.log("Respuesta lote:", oResponseData);

                            var bEsValido = false;
                            if (oResponseData.outLote === "true" || oResponseData.outLote === true) {
                                bEsValido = true;
                            } else if (oResponseData.outLote === "false" || oResponseData.outLote === false) {
                                bEsValido = false;
                            }

                            if (bEsValido) {
                                // Detectar de dónde vino el escaneo
                                if (!this._slotContext) {
                                    // Viene del input superior → buscar slot vacío
                                    this._ejecutarUpdate();
                                } else {
                                    // Viene del botón por fila → actualizar ese slot
                                    this._procesarSlotValidado();
                                }
                            } else {
                                sap.m.MessageToast.show(oBundle.getText("loteNoValido"));
                                // Solo limpiar input si viene del input superior
                                if (!this._slotContext) {
                                    oInput.setValue("");
                                    oInput.focus();
                                }
                                // Limpiar contexto siempre
                                this._slotContext = null;
                            }
                        }.bind(this),
                        // ERROR callback de validación de lote
                        function (oError, sHttpErrorMessage) {
                            oView.byId("idPluginPanel").setBusy(false);
                            var err = oError || sHttpErrorMessage;
                            sap.m.MessageToast.show("Error al validar lote " + err);

                            // Solo limpiar input si viene del input superior
                            if (!this._slotContext) {
                                oInput.setValue("");
                                oInput.focus();
                            }
                            // Limpiar contexto siempre
                            this._slotContext = null;
                        }.bind(this)
                    );
                }.bind(this),
                // ERROR callback de validación de material
                function (oError, sHttpErrorMessage) {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorValidacion") || ("Error validación material: " + (sHttpErrorMessage || "")));
                    // Solo limpiar input si viene del input superior
                    if (!this._slotContext) {
                        oInput.setValue("");
                        oInput.focus();
                    }
                    // Limpiar contexto siempre
                    this._slotContext = null;
                }.bind(this)
            );
        },
        _ejecutarUpdate: function () {
            var oView = this.getView();
            var oInput = oView.byId("scanInput");
            var sBarcode = oInput.getValue().trim();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;
            var sActiveKey = this._getActiveKey();

            // Refrescar slots desde backend antes de operar (evitar datos obsoletos)
            this._refreshSlotsFromBackend().then(function (oRefresh) {
                if (!oRefresh) {
                    sap.m.MessageToast.show(oBundle.getText("errorRefrescarSlots"));
                    oInput.setValue(""); oInput.focus();
                    return;
                }

                // Slots de la tabla activa
                var aItems = sActiveKey === "CINTAS" ? oRefresh.slotsCin : oRefresh.slotsAlm;

                var sNormalizado = sBarcode.toUpperCase();
                var partsEscaneado = sNormalizado.split('!');
                var materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!');

                // Verificar duplicado en la tabla activa
                var oExiste = aItems.find(function (Item) {
                    var valorItem = (Item.value || "").toString().trim().toUpperCase();
                    if (!valorItem) return false;
                    return valorItem.split('!').slice(0, 2).join('!') === materialLoteEscaneado;
                });
                if (oExiste) {
                    sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sBarcode, oExiste.attribute]));
                    oInput.setValue(""); oInput.focus();
                    return;
                }

                // Encontrar primer slot vacío
                var oEmptySlot = aItems.find(function (item) { return !item.value || item.value === ""; });
                if (oEmptySlot) {
                    var sNoCarga = oView.byId("noCarga").getValue() || "";
                    var sBarcodeConSecuencia = sNoCarga ? sBarcode + "!" + sNoCarga : sBarcode;
                    oEmptySlot.value = sBarcodeConSecuencia;

                    // Actualizar el modelo de la tabla activa
                    var oActiveTable = sActiveKey === "CINTAS"
                        ? oView.byId("idSlotTableCintas")
                        : oView.byId("idSlotTableAlambre");
                    oActiveTable.getModel().setProperty("/ITEMS", aItems);
                    oActiveTable.getModel().refresh(true);
                    self._updateProgressIndicator();
                } else {
                    sap.m.MessageToast.show(oBundle.getText("sinLotes"));
                    return;
                }

                oInput.setValue(""); oInput.focus();

                // Construir lista de editados usando el pool completo (cintas + alambre)
                var slotTipo = oView.byId("slotType").getValue();
                var aEdited = [
                    { attribute: "SLOTTIPO", value: slotTipo },
                    { attribute: "SLOTQTY_CIN", value: oRefresh.iQtyCin.toString() },
                    { attribute: "SLOTQTY_ALM", value: oRefresh.iQtyAlm.toString() }
                ].concat(oRefresh.allSlots.map(function (slot) {
                    return { attribute: slot.attribute, value: slot.value };
                }));

                var oSapApi = self.getPublicApiRestDataSourceUri();
                var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

                self.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                    var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                    if (!aOriginal) { return; }

                    var editedMap = {};
                    aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });

                    var aFinal = aOriginal.map(function (item) {
                        return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                    });
                    for (var key in editedMap) {
                        if (!aFinal.find(function (i) { return i.attribute === key; })) {
                            aFinal.push({ attribute: key, value: editedMap[key] });
                        }
                    }

                    self.setCustomValuesPp({
                        inCustomValues: aFinal,
                        inPlant: oPODParams.PLANT_ID,
                        inWorkCenter: oPODParams.WORK_CENTER,
                        inMaterialLote: materialLoteEscaneado || ""
                    }, oSapApi).then(function () {
                        sap.m.MessageToast.show(oBundle.getText("slotActualizado"));
                        self._checkCargaCompleta();
                    }).catch(function () {
                        sap.m.MessageToast.show(oBundle.getText("errorActualizarSlot"));
                    });
                });
            });
        },
        onScanSuccess: function (oEvent) {
            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
            } else {
                if (oEvent.getParameter("text")) {
                    this.oScanInput.setValue(oEvent.getParameter("text"));
                    this.onBarcodeSubmit();
                } else {
                    this.oScanInput.setValue('');
                }
            }
        },
        onScanError: function (oEvent) {
            sap.m.MessageToast.show("Scan failed: " + oEvent, { duration: 1000 });
        },
        onScanLiveupdate: function (oEvent) {
            // User can implement the validation about inputting value
        },
        //funcion del boton #Eliminar-delete elimina un elemento de la tabla activa
        onDeleteSlot: function (oEvent) {
            var oView = this.getView();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;

            // Detectar en qué tabla está el botón (cintas o alambre)
            var oButton = oEvent.getSource();
            var oItem = oButton.getParent(); // ColumnListItem
            var oTable = oItem.getParent().getParent(); // Table
            var sCintasId = oView.createId("idSlotTableCintas");
            var sActiveKey = (oTable.getId() === sCintasId) ? "CINTAS" : "ALAMBRE";

            var oModel = oTable.getModel();
            var aSlots = oModel.getProperty("/ITEMS");
            var iIndex = oTable.indexOfItem(oItem);
            if (iIndex === -1) { return; }

            // Recorrer los slots hacia arriba para rellenar el hueco
            for (var i = iIndex; i < aSlots.length - 1; i++) {
                aSlots[i].value = aSlots[i + 1].value;
                aSlots[i].loteQty = aSlots[i + 1].loteQty;
                aSlots[i].loteUom = aSlots[i + 1].loteUom;
            }
            aSlots[aSlots.length - 1].value = "";
            aSlots[aSlots.length - 1].loteQty = "";
            aSlots[aSlots.length - 1].loteUom = "";

            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator();
            sap.m.MessageToast.show(oBundle.getText("loteEliminado"));

            // Construir pool completo para el update
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);

            var slotTipo = oView.byId("slotType").getValue();
            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY_CIN", value: iQtyCin.toString() },
                { attribute: "SLOTQTY_ALM", value: iQtyAlm.toString() }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { return; }

                var editedMap = {};
                aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });

                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                });
                for (var key in editedMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }
                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("loteActualizadoAntesEliminar"));
                }).catch(function () {
                    sap.m.MessageBox.error(oBundle.getText("errorActualizar"));
                });
            });
        },
        //
        onScanSlotSuccess: function (oEvent) {
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
                return;
            }
            var sBarcode = (oEvent.getParameter("text") || "").trim();
            if (!sBarcode) { return; }

            var parts = sBarcode.toUpperCase().split('!');
            if (parts.length < 2 || !parts[0] || !parts[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                return;
            }

            var sMaterial = parts[0].trim();
            var sLote = parts[1].trim();

            // Detectar en qué tabla está el botón (cintas o alambre)
            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();
            var oTable = oItem.getParent().getParent();
            var sCintasId = this.getView().createId("idSlotTableCintas");
            var sTableKey = (oTable.getId() === sCintasId) ? "CINTAS" : "ALAMBRE";

            // Guarda contexto para actualizar la fila cuando ambas validaciones pasen
            this._slotContext = { oEvent: oEvent, sBarcode: sBarcode, loteExtraido: sLote, sTableId: sTableKey };

            // Reutiliza la validación combinada
            this._validarMaterialYLote(sLote, sMaterial);
        },
        /**
         * Procesar slot específico validado (scan de botón de fila)
         */
        _procesarSlotValidado: function () {
            if (!this._slotContext) {
                console.error("No hay contexto de slot guardado");
                return;
            }

            var slotCtx = this._slotContext;
            var oEvent = slotCtx.oEvent;
            var sBarcode = slotCtx.sBarcode;
            var sTableKey = slotCtx.sTableId || "CINTAS";

            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oView = this.getView();
            var self = this;

            // Obtener la tabla correcta según el contexto guardado
            var oTable = sTableKey === "CINTAS"
                ? oView.byId("idSlotTableCintas")
                : oView.byId("idSlotTableAlambre");

            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();
            var iIndex = oTable.indexOfItem(oItem);
            var oModel = oTable.getModel();
            var aSlots = oModel.getProperty("/ITEMS");

            if (iIndex === -1 || !aSlots[iIndex]) { return; }

            var sNormalizado = sBarcode.toUpperCase();
            var partsEscaneado = sNormalizado.split('!');
            var materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!');

            // Verificar duplicado en esta tabla
            var sExiste = aSlots.find(function (slot, idx) {
                if (idx === iIndex) { return false; }
                var valorSlot = (slot.value || "").toString().trim().toUpperCase();
                if (!valorSlot) return false;
                return valorSlot.split('!').slice(0, 2).join('!') === materialLoteEscaneado;
            });
            if (sExiste) {
                sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sBarcode, sExiste.attribute]));
                this._slotContext = null;
                return;
            }

            // Si el valor ya es el mismo en esa fila, no actualizar
            var valorActual = (aSlots[iIndex].value || "").toString().trim().toUpperCase();
            if (valorActual && valorActual.split('!').slice(0, 2).join('!') === materialLoteEscaneado) {
                sap.m.MessageToast.show(oBundle.getText("sinCambios"));
                this._slotContext = null;
                return;
            }

            var sNoCarga = oView.byId("noCarga").getValue() || "";
            var sBarcodeConSecuencia = sNoCarga ? sBarcode + "!" + sNoCarga : sBarcode;
            aSlots[iIndex].value = sBarcodeConSecuencia;
            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator();

            // Construir pool completo para el update
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);

            var slotTipo = oView.byId("slotType").getValue();
            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY_CIN", value: iQtyCin.toString() },
                { attribute: "SLOTQTY_ALM", value: iQtyAlm.toString() }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { self._slotContext = null; return; }

                var editedMap = {};
                aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });
                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                });
                for (var key in editedMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }

                self.setCustomValuesPp({
                    inCustomValues: aFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER,
                    inMaterialLote: materialLoteEscaneado || ""
                }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("slotActualizado"));
                    self._slotContext = null;
                    self._checkCargaCompleta();
                }).catch(function () {
                    sap.m.MessageToast.show(oBundle.getText("errorActualizar"));
                    self._slotContext = null;
                });
            });
        },

        onBeforeRenderingPlugin: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                var sStatus = oPodSelectionModel.selectedPhaseData.status || "";
                gOperationPhase = {
                    status: sStatus
                };
            }

            this.subscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        },
        onPhaseSelectionEventCustom: function (sChannelId, sEventId, oData) {
            if (this.isEventFiredByThisPlugin(oData)) {
                return;
            }
            gOperationPhase = oData;
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
        },

        isSubscribingToNotifications: function () {

            var bNotificationsEnabled = true;

            return bNotificationsEnabled;
        },


        getCustomNotificationEvents: function (sTopic) {
            //return ["template"];
        },


        getNotificationMessageHandler: function (sTopic) {

            //if (sTopic === "template") {
            //    return this._handleNotificationMessage;
            //}
            return null;
        },

        _handleNotificationMessage: function (oMsg) {

            var sMessage = "Message not found in payload 'message' property";
            if (oMsg && oMsg.parameters && oMsg.parameters.length > 0) {
                for (var i = 0; i < oMsg.parameters.length; i++) {

                    switch (oMsg.parameters[i].name) {
                        case "template":

                            break;
                        case "template2":


                    }



                }
            }

        },
        getWorkCenterCustomValues: function (sParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.WORKCENTERS, sParams, function (oRes) {
                    const oData = Array.isArray(oRes) ? oRes[0] : oRes;
                    resolve(oData);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        _getValidatedCustomValues: function (oResponseData, oBundle) {
            if (!oResponseData || oResponseData === "Error" || !Array.isArray(oResponseData.customValues)) {
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener customValues");
                return null;
            }
            return oResponseData.customValues;
        },
        setCustomValuesPp: function (oParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxPostRequest(oSapApi + this.ApiPaths.putBatchSlotWorkCenter, oParams, function (oRes) {
                    resolve(oRes);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        /**
         * Iniciar nueva carga para la tabla activa (CINTAS o ALAMBRE).
         * Para CINTAS: incrementa NO_CARGA y actualiza SLOTQTY_CIN.
         * Para ALAMBRE: solo actualiza SLOTQTY_ALM (NO_CARGA no cambia).
         * @param {number} iCantidad - Cantidad de lotes a escanear
         * @param {string} sTabla - "CINTAS" o "ALAMBRE"
         */
        _iniciarNuevaCarga: function (iCantidad, sTabla) {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;

            oView.byId("idPluginPanel").setBusy(true);
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oCurrentRes) {
                var aCurrentCV = self._getValidatedCustomValues(oCurrentRes, oBundle);
                if (!aCurrentCV) { oView.byId("idPluginPanel").setBusy(false); return; }

                var aEdited = [];

                if (sTabla === "CINTAS") {
                    // Incrementar NO_CARGA y actualizar SLOTQTY_CIN
                    var oNoCargaCV = aCurrentCV.find(function (cv) { return cv.attribute === "NO_CARGA"; });
                    var iNoCargaActual = oNoCargaCV ? (parseInt(oNoCargaCV.value || "0", 10) || 0) : 0;
                    var iNuevaCarga = iNoCargaActual + 1;
                    aEdited.push({ attribute: "NO_CARGA", value: iNuevaCarga.toString() });
                    aEdited.push({ attribute: "SLOTQTY_CIN", value: iCantidad.toString() });
                    // Vaciar slots existentes de cintas
                    var iQtyCinActual = parseInt((aCurrentCV.find(function (cv) { return cv.attribute === "SLOTQTY_CIN"; }) || { value: "0" }).value, 10) || 0;
                    var iMaxCin = Math.max(iQtyCinActual, iCantidad);
                    for (var c = 1; c <= iMaxCin; c++) {
                        aEdited.push({ attribute: "SLOT" + c.toString().padStart(3, "0"), value: "" });
                    }
                } else {
                    // Solo actualizar SLOTQTY_ALM y vaciar slots de alambre
                    var iQtyCinRef = parseInt((aCurrentCV.find(function (cv) { return cv.attribute === "SLOTQTY_CIN"; }) || { value: "0" }).value, 10) || 0;
                    var iQtyAlmActual = parseInt((aCurrentCV.find(function (cv) { return cv.attribute === "SLOTQTY_ALM"; }) || { value: "0" }).value, 10) || 0;
                    aEdited.push({ attribute: "SLOTQTY_ALM", value: iCantidad.toString() });
                    var iMaxAlm = Math.max(iQtyAlmActual, iCantidad);
                    for (var a = iQtyCinRef + 1; a <= iQtyCinRef + iMaxAlm; a++) {
                        aEdited.push({ attribute: "SLOT" + a.toString().padStart(3, "0"), value: "" });
                    }
                }

                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });
                var aFinal = aCurrentCV.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    oView.byId("idPluginPanel").setBusy(false);

                    if (sTabla === "CINTAS") {
                        var iNoCargaFinal = parseInt((aFinal.find(function (cv) { return cv.attribute === "NO_CARGA"; }) || { value: "1" }).value, 10) || 1;
                        oView.byId("noCarga").setValue(iNoCargaFinal.toString());
                        oView.byId("slotQty_cintas").setValue(iCantidad.toString());
                    } else {
                        oView.byId("slotQty_alambre").setValue(iCantidad.toString());
                    }

                    self._cargaActual = { noCarga: parseInt(oView.byId("noCarga").getValue(), 10), cantidad: iCantidad };
                    sap.m.MessageToast.show(oBundle.getText("cargaInitSuccess", [oView.byId("noCarga").getValue(), iCantidad]));
                    setTimeout(function () { self.onGetCustomValues(); }, 1000);

                }).catch(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorInitCarga"));
                });
            }).catch(function () {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },


        /**
         * Actualizar indicador de progreso (contador y barra) - agrega ambas tablas
         */
        _updateProgressIndicator: function () {
            var oView = this.getView();
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aItemsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var iTotalQty = iQtyCin + iQtyAlm;

            var iEscCin = aItemsCin.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscAlm = aItemsAlm.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscaneados = iEscCin + iEscAlm;

            // Actualizar contador de texto
            var oProgressCounter = oView.byId("progressCounter");
            if (oProgressCounter) {
                oProgressCounter.setText(iEscaneados + "/" + iTotalQty);
            }

            // Actualizar barra de progreso
            var oProgressBar = oView.byId("progressBar");
            if (oProgressBar && iTotalQty > 0) {
                var iPercent = Math.round((iEscaneados / iTotalQty) * 100);
                oProgressBar.setPercentValue(iPercent);
                oProgressBar.setDisplayValue(iPercent + "%");
                if (iEscaneados === 0) { oProgressBar.setState("None"); }
                else if (iEscaneados < iTotalQty) { oProgressBar.setState("Warning"); }
                else { oProgressBar.setState("Success"); }
            } else if (oProgressBar) {
                oProgressBar.setPercentValue(0);
                oProgressBar.setDisplayValue("0%");
                oProgressBar.setState("None");
            }

            // Sync slotQty visible con la tabla activa
            var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
            oView.byId("slotQty").setValue(sActiveKey === "CINTAS" ? iQtyCin.toString() : iQtyAlm.toString());
        },

        /**
         * Verificar si la carga está completa (ambas tablas) y mostrar mensaje de éxito
         */
        _checkCargaCompleta: function () {
            var oView = this.getView();
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aItemsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var iTotalQty = iQtyCin + iQtyAlm;

            var iEscCin = aItemsCin.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscAlm = aItemsAlm.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscaneados = iEscCin + iEscAlm;

            var sNoCarga = oView.byId("noCarga").getValue() || "0";
            var oBundle = oView.getModel("i18n").getResourceBundle();

            if (iTotalQty > 0 && iEscaneados === iTotalQty) {
                sap.m.MessageBox.success(
                    oBundle.getText("cargaCompletadaMensaje", [sNoCarga, iEscaneados, iTotalQty]),
                    { title: oBundle.getText("cargaCompletadaTitulo") }
                );
            }
        },

        /**
         * Obtener cantidad de cintas desde las características de la orden.
         * Revisa CT_100035_500 primero; si no tiene valor, revisa CT_100038_500.
         * El valor llega como "34 PC" → se parsea el número y se almacena en _suggestedQtyCintas.
         */
        onGetOrderCustomValues: function () {
            var oView = this.getView();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var self = this;

            var requestJSON = {
                "plant": oPODParams.PLANT_ID,
                "order": oPODParams.ORDER_ID
            };

            var url = this.getPublicApiRestDataSourceUri() + this.ApiPaths.CHARACHTERISTICS;
            this.ajaxGetRequest(url, requestJSON,
                function (oResponseData) {
                    if (oResponseData && Array.isArray(oResponseData)) {
                        // Buscar CT_100035_500 primero; si no tiene valor, usar CT_100038_500
                        var oCustomValue =
                            oResponseData.find(function (cv) { return cv.attribute === "CT_100035_500" && cv.value; }) ||
                            oResponseData.find(function (cv) { return cv.attribute === "CT_100038_500" && cv.value; });

                        if (oCustomValue && oCustomValue.value) {
                            // Parsear "34 PC" → número
                            var sRawValue = oCustomValue.value.trim();
                            var parts = sRawValue.split(' ');
                            var sNumeric = parts[0] || "0";
                            oView.byId("slotQtySuggest").setValue(sRawValue);
                            self._suggestedQtyCintas = parseInt(sNumeric, 10) || 0;
                        } else {
                            oView.byId("slotQtySuggest").setValue("");
                            self._suggestedQtyCintas = 0;
                        }
                    }
                },
                function (oError, sHttpErrorMessage) {
                    var err = oError || sHttpErrorMessage;
                    sap.m.MessageToast.show(err);
                }
            );
        },

        onExit: function () {
            PluginViewController.prototype.onExit.apply(this, arguments);
            this.unsubscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        }
    });
});